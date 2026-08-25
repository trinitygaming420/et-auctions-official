import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const shippoKey = Deno.env.get("SHIPPO_API_TOKEN") || "";
const base = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(base, service);
const returnUrl = `${base}/functions/v1/marketplace-return`;

const PLATFORM_FEE_RATE = 0.05;
const DEFAULT_PAYOUT_DELAY_HOURS = 48;

type Profile = {
  id: string;
  role?: string | null;
  seller_approved?: boolean | null;
  stripe_account_id?: string | null;
  stripe_onboarding_complete?: boolean | null;
  payouts_enabled?: boolean | null;
};

function requireStripe() {
  if (!stripeKey || !stripeKey.startsWith("sk_")) {
    throw new Error(
      "Stripe is not configured. Add STRIPE_SECRET_KEY in Supabase Edge Function Secrets, then redeploy marketplace-api.",
    );
  }
}

function requireShippo() {
  if (!shippoKey) {
    throw new Error(
      "Shippo is not configured. Add SHIPPO_API_TOKEN in Supabase Edge Function Secrets, then redeploy marketplace-api.",
    );
  }
}

function requireAdmin(profile: Profile) {
  if (profile.role !== "admin") {
    throw new Error("Admin access required");
  }
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number) {
  const cents = Math.round(value * 100);

  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error("Invalid payment amount");
  }

  return cents;
}

async function stripe(
  path: string,
  method = "GET",
  values?: Record<string, string>,
  idempotencyKey?: string,
) {
  requireStripe();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeKey}`,
  };

  if (values) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: values ? new URLSearchParams(values) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Stripe request failed");
  }

  return data;
}

async function shippo(
  path: string,
  method = "POST",
  body?: unknown,
) {
  requireShippo();

  const response = await fetch(`https://api.goshippo.com/${path}`, {
    method,
    headers: {
      Authorization: `ShippoToken ${shippoKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail || data?.message || "Shippo request failed",
    );
  }

  return data;
}

async function currentUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(
    "Bearer ",
    "",
  );

  if (!token) {
    throw new Error("Sign in required");
  }

  const { data, error } = await sb.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Sign in required");
  }

  return data.user;
}

async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error("Profile was not found");
  }

  return data as Profile;
}

async function verifyOrderPayment(order: any) {
  requireStripe();

  if (!order?.stripe_checkout_session_id) {
    throw new Error("Checkout has not started");
  }

  const session = await stripe(
    `checkout/sessions/${order.stripe_checkout_session_id}`,
  );

  if (session.payment_status !== "paid") {
    throw new Error("Order payment is not complete");
  }

  return session;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const user = await currentUser(req);
    const body = await req.json();
    const action = body.action;
    const profile = await getProfile(user.id);

    // -----------------------------------------------------------------------
    // SELLER FINANCIAL SETUP
    // Sellers get Stripe Express accounts only for receiving later transfers.
    // Customer charges stay on the E&T Auctions platform Stripe account.
    // -----------------------------------------------------------------------
    if (action === "connect_onboarding") {
      requireStripe();

      if (!profile.seller_approved) {
        throw new Error("Seller approval required");
      }

      let account = profile.stripe_account_id;

      if (account) {
        try {
          await stripe(`accounts/${account}`);
        } catch (error) {
          if (
            String(error).toLowerCase().includes("no such account")
          ) {
            account = null;
          } else {
            throw error;
          }
        }
      }

      if (!account) {
        const created = await stripe("accounts", "POST", {
          type: "express",
          country: "US",
          email: user.email || "",
          "capabilities[transfers][requested]": "true",
          "business_profile[product_description]":
            "Live online auctions of consumer products",
          "metadata[user_id]": user.id,
        });

        account = created.id;

        const { error: updateError } = await sb
          .from("profiles")
          .update({
            stripe_account_id: account,
            stripe_onboarding_complete: false,
            payouts_enabled: false,
          })
          .eq("id", user.id);

        if (updateError) {
          throw new Error("Could not save the Stripe account");
        }
      }

      const link = await stripe("account_links", "POST", {
        account,
        refresh_url: `${returnUrl}?result=refresh`,
        return_url: `${returnUrl}?result=success`,
        type: "account_onboarding",
        "collection_options[fields]": "eventually_due",
      });

      return json({ url: link.url });
    }

    if (action === "connect_status") {
      requireStripe();

      if (!profile.stripe_account_id) {
        return json({
          complete: false,
          detailsSubmitted: false,
          transfersEnabled: false,
          payoutsEnabled: false,
          currentlyDue: [],
          errors: [],
          disabledReason: null,
        });
      }

      const account = await stripe(
        `accounts/${profile.stripe_account_id}`,
      );

      const detailsSubmitted = !!account.details_submitted;
      const transfersEnabled =
        account.capabilities?.transfers === "active";
      const payoutsEnabled = !!account.payouts_enabled;
      const currentlyDue =
        account.requirements?.currently_due || [];
      const errors = account.requirements?.errors || [];
      const disabledReason =
        account.requirements?.disabled_reason || null;

      const complete =
        detailsSubmitted &&
        transfersEnabled &&
        payoutsEnabled &&
        currentlyDue.length === 0;

      await sb
        .from("profiles")
        .update({
          stripe_onboarding_complete: complete,
          payouts_enabled: payoutsEnabled,
        })
        .eq("id", user.id);

      return json({
        complete,
        detailsSubmitted,
        transfersEnabled,
        payoutsEnabled,
        currentlyDue,
        errors,
        disabledReason,
      });
    }

    // -----------------------------------------------------------------------
    // CUSTOMER CHECKOUT
    // IMPORTANT: There is intentionally NO transfer_data/destination here.
    // Stripe charges 100% of the buyer's payment to the PLATFORM account.
    //
    // Seller earnings are recorded as 95% of merchandise subtotal.
    // Buyer-paid shipping stays on platform to cover the shipping label.
    // -----------------------------------------------------------------------
    if (action === "create_checkout") {
      requireStripe();
      requireShippo();

      const { data: order, error } = await sb
        .from("orders")
        .select(
          "*,products(*),buyer:profiles!orders_buyer_id_fkey(shipping_address),seller:profiles!orders_seller_id_fkey(shipping_address,stripe_account_id,stripe_onboarding_complete,payouts_enabled)",
        )
        .eq("id", body.orderId)
        .eq("buyer_id", user.id)
        .single();

      if (error || !order) {
        throw new Error("Order not found");
      }

      const orderStatus = String(order.status || "").toLowerCase();

      if (
        ["cancelled", "canceled", "refunded", "failed"].includes(
          orderStatus,
        )
      ) {
        throw new Error(
          "This sale is no longer available for payment",
        );
      }

      if (
        ["paid", "packed", "shipped", "delivered", "completed"].includes(
          orderStatus,
        )
      ) {
        return json({
          alreadyPaid: true,
          url: null,
        });
      }

      if (orderStatus !== "payment_due") {
        throw new Error("This order is not currently payable");
      }

      if (order.show_id) {
        const { data: liveShow, error: liveShowError } = await sb
          .from("shows")
          .select("id,status")
          .eq("id", order.show_id)
          .single();

        if (
          liveShowError ||
          !liveShow ||
          String(liveShow.status || "").toLowerCase() !== "live"
        ) {
          throw new Error(
            "This live stream has ended and the order can no longer be paid",
          );
        }
      }

      if (
        !order.buyer?.shipping_address ||
        !order.seller?.shipping_address
      ) {
        throw new Error(
          "Buyer and seller shipping addresses are required",
        );
      }

      if (
        !order.seller?.stripe_account_id ||
        !order.seller?.stripe_onboarding_complete
      ) {
        throw new Error(
          "Seller must complete financial setup before accepting paid orders",
        );
      }

      // If a Checkout Session is already open, reuse it.
      if (order.stripe_checkout_session_id) {
        try {
          const existing = await stripe(
            `checkout/sessions/${order.stripe_checkout_session_id}`,
          );

          if (
            existing.payment_status === "paid" ||
            (existing.status === "open" && existing.url)
          ) {
            return json({
              url: existing.url || null,
              shipping: Number(order.shipping_total || 0),
              total: Number(order.total || 0),
              alreadyPaid: existing.payment_status === "paid",
            });
          }
        } catch {
          // Create a fresh session below if the old one is unusable.
        }
      }

      const product = order.products;

      if (!product) {
        throw new Error("Product was not found");
      }

      const shipment = await shippo("shipments/", "POST", {
        address_from: {
          ...order.seller.shipping_address,
          country: "US",
        },
        address_to: {
          ...order.buyer.shipping_address,
          country: "US",
        },
        parcels: [
          {
            length: String(product.length_in),
            width: String(product.width_in),
            height: String(product.height_in),
            distance_unit: "in",
            weight: String(product.weight_oz),
            mass_unit: "oz",
          },
        ],
        async: false,
      });

      const rates = (shipment.rates || [])
        .filter((rate: any) => rate.amount)
        .sort(
          (a: any, b: any) =>
            Number(a.amount) - Number(b.amount),
        );

      if (!rates[0]) {
        throw new Error("No shipping rate was available");
      }

      const shipping = money(Number(rates[0].amount));
      const subtotal = money(
        Number(order.subtotal ?? order.total ?? 0),
      );

      if (!Number.isFinite(subtotal) || subtotal <= 0) {
        throw new Error("Order subtotal is invalid");
      }

      const platformFee = money(subtotal * PLATFORM_FEE_RATE);
      const sellerPayoutAmount = money(subtotal - platformFee);
      const total = money(subtotal + shipping);

      const productName =
        product.title || product.name || "Auction item";

      const session = await stripe(
        "checkout/sessions",
        "POST",
        {
          mode: "payment",
          success_url: `${returnUrl}?result=success`,
          cancel_url: `${returnUrl}?result=cancel`,
          customer_email: user.email || "",

          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][product_data][name]":
            productName,
          "line_items[0][price_data][unit_amount]": String(
            toCents(subtotal),
          ),
          "line_items[0][quantity]": "1",

          "line_items[1][price_data][currency]": "usd",
          "line_items[1][price_data][product_data][name]":
            "Shipping",
          "line_items[1][price_data][unit_amount]": String(
            toCents(shipping),
          ),
          "line_items[1][quantity]": "1",

          "metadata[order_id]": order.id,
          "metadata[seller_id]": order.seller_id,
          "metadata[platform_fee]": String(platformFee),
          "metadata[seller_payout_amount]": String(
            sellerPayoutAmount,
          ),

          "payment_intent_data[metadata][order_id]": order.id,
          "payment_intent_data[metadata][seller_id]":
            order.seller_id,
        },
      );

      const { data: checkoutOrder, error: updateError } = await sb
        .from("orders")
        .update({
          subtotal,
          shipping_total: shipping,
          total,
          platform_fee: platformFee,
          seller_payout_amount: sellerPayoutAmount,
          payout_status: "not_requested",
          shippo_shipment_id: shipment.object_id,
          shippo_rate_id: rates[0].object_id,
          stripe_checkout_session_id: session.id,
          payment_method: "stripe",
        })
        .eq("id", order.id)
        .eq("status", "payment_due")
        .select("id,status")
        .maybeSingle();

      if (updateError) {
        try {
          if (session?.status === "open") {
            await stripe(
              `checkout/sessions/${session.id}/expire`,
              "POST",
              {},
            );
          }
        } catch {
          // Stripe webhook remains the final payment-state authority.
        }

        throw new Error("Could not save checkout information");
      }

      if (!checkoutOrder) {
        try {
          if (session?.status === "open") {
            await stripe(
              `checkout/sessions/${session.id}/expire`,
              "POST",
              {},
            );
          }
        } catch {
          // Do not return a payment link for a no-longer-payable order.
        }

        throw new Error(
          "The live ended before checkout could be opened",
        );
      }

      if (order.show_id) {
        const { data: showAfterCheckout } = await sb
          .from("shows")
          .select("status")
          .eq("id", order.show_id)
          .maybeSingle();

        if (
          !showAfterCheckout ||
          String(showAfterCheckout.status || "").toLowerCase() !== "live"
        ) {
          try {
            await stripe(
              `checkout/sessions/${session.id}/expire`,
              "POST",
              {},
            );
          } catch {
            // Webhook protection handles Stripe if its state already changed.
          }

          throw new Error(
            "The live ended before checkout could be opened",
          );
        }
      }

      return json({
        url: session.url,
        shipping,
        subtotal,
        platformFee,
        sellerPayoutAmount,
        total,
      });
    }

    // -----------------------------------------------------------------------
    // VERIFY BUYER CHECKOUT
    // Only payment_due can transition to paid.
    // Cancelled/refunded sales can never be resurrected here.
    // -----------------------------------------------------------------------
    if (action === "verify_checkout") {
      requireStripe();

      const { data: order, error } = await sb
        .from("orders")
        .select("*")
        .eq("id", body.orderId)
        .eq("buyer_id", user.id)
        .single();

      if (error || !order) {
        throw new Error("Order not found");
      }

      const status = String(order.status || "").toLowerCase();

      if (
        ["cancelled", "canceled", "refunded", "failed"].includes(status)
      ) {
        throw new Error(
          "This sale was cancelled and can no longer be paid",
        );
      }

      if (
        ["paid", "packed", "shipped", "delivered", "completed"].includes(
          status,
        )
      ) {
        return json({
          paid: true,
          alreadyPaid: true,
          paymentIntentId: order.stripe_payment_intent_id || null,
        });
      }

      if (status !== "payment_due") {
        throw new Error("This order is not currently payable");
      }

      if (order.show_id) {
        const { data: liveShow, error: liveShowError } = await sb
          .from("shows")
          .select("id,status")
          .eq("id", order.show_id)
          .single();

        if (
          liveShowError ||
          !liveShow ||
          String(liveShow.status || "").toLowerCase() !== "live"
        ) {
          throw new Error(
            "This live stream has ended and the order can no longer be paid",
          );
        }
      }

      const session = await verifyOrderPayment(order);

      const updates: Record<string, unknown> = {
        status: "paid",
        payout_status: "not_requested",
        paid_at: order.paid_at || new Date().toISOString(),
      };

      if (
        typeof session.payment_intent === "string" &&
        session.payment_intent
      ) {
        updates.stripe_payment_intent_id = session.payment_intent;
      }

      const { data: updatedOrder, error: updateError } = await sb
        .from("orders")
        .update(updates)
        .eq("id", order.id)
        .eq("status", "payment_due")
        .select("id,status")
        .maybeSingle();

      if (updateError) {
        throw new Error("Could not update paid order");
      }

      if (!updatedOrder) {
        throw new Error(
          "The live ended before payment could be confirmed",
        );
      }

      return json({
        paid: true,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
      });
    }

    // -----------------------------------------------------------------------
    // SHIPPING LABEL
    // Platform buys the label using Shippo. Buyer shipping was already
    // collected by the platform during checkout.
    // -----------------------------------------------------------------------
    if (action === "buy_label") {
      requireShippo();

      const { data: order, error } = await sb
        .from("orders")
        .select("*")
        .eq("id", body.orderId)
        .eq("seller_id", user.id)
        .single();

      if (
        error ||
        !order ||
        !["paid", "packed"].includes(order.status)
      ) {
        throw new Error("Paid order not found");
      }

      await verifyOrderPayment(order);

      if (!order.shippo_rate_id) {
        throw new Error("Shipping rate not found");
      }

      const transaction = await shippo(
        "transactions/",
        "POST",
        {
          rate: order.shippo_rate_id,
          label_file_type: "PDF",
          async: false,
        },
      );

      if (transaction.status !== "SUCCESS") {
        throw new Error(
          (transaction.messages || [])
            .map((message: any) => message.text)
            .join(", ") || "Label purchase failed",
        );
      }

      const { error: updateError } = await sb
        .from("orders")
        .update({
          status: "shipped",
          shipping_label_url: transaction.label_url,
          tracking_number: transaction.tracking_number,
          shipping_carrier:
            transaction.rate?.provider || "Carrier",
          shipped_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (updateError) {
        throw new Error("Could not save shipping label");
      }

      return json({
        labelUrl: transaction.label_url,
        trackingNumber: transaction.tracking_number,
      });
    }

    // -----------------------------------------------------------------------
    // SELLER PAYOUT REQUESTS
    // Requesting a payout does NOT move money.
    // It only creates a pending request for the platform admin.
    // -----------------------------------------------------------------------
    if (action === "request_payout") {
      requireStripe();

      if (!profile.seller_approved) {
        throw new Error("Seller approval required");
      }

      if (
        !profile.stripe_account_id ||
        !profile.stripe_onboarding_complete ||
        !profile.payouts_enabled
      ) {
        throw new Error(
          "Complete seller financial setup before requesting a payout",
        );
      }

      const { data: order, error } = await sb
        .from("orders")
        .select("*")
        .eq("id", body.orderId)
        .eq("seller_id", user.id)
        .single();

      if (error || !order) {
        throw new Error("Order not found");
      }

      if (
        ["cancelled", "canceled", "refunded"].includes(
          String(order.status || "").toLowerCase(),
        )
      ) {
        throw new Error("This order is not eligible for payout");
      }

      await verifyOrderPayment(order);

      const subtotal = money(
        Number(order.subtotal ?? order.total ?? 0),
      );

      const platformFee = money(
        Number(
          order.platform_fee ??
            subtotal * PLATFORM_FEE_RATE,
        ),
      );

      const payoutAmount = money(
        Number(
          order.seller_payout_amount ??
            subtotal - platformFee,
        ),
      );

      if (payoutAmount <= 0) {
        throw new Error(
          "No seller payout is available for this order",
        );
      }

      const { data: existing } = await sb
        .from("payout_requests")
        .select("*")
        .eq("order_id", order.id)
        .maybeSingle();

      if (existing) {
        if (existing.status === "paid") {
          return json({
            request: existing,
            message: "This order has already been paid out",
          });
        }

        if (existing.status === "rejected") {
          const {
            data: reopened,
            error: reopenError,
          } = await sb
            .from("payout_requests")
            .update({
              status: "pending",
              amount: payoutAmount,
              platform_fee: platformFee,
              requested_at: new Date().toISOString(),
              reviewed_at: null,
              reviewed_by: null,
              rejection_reason: null,
            })
            .eq("id", existing.id)
            .select("*")
            .single();

          if (reopenError) {
            throw new Error(
              "Could not reopen payout request",
            );
          }

          await sb
            .from("orders")
            .update({
              payout_status: "requested",
            })
            .eq("id", order.id);

          return json({
            request: reopened,
          });
        }

        return json({
          request: existing,
        });
      }

      const {
        data: payoutRequest,
        error: insertError,
      } = await sb
        .from("payout_requests")
        .insert({
          order_id: order.id,
          seller_id: user.id,
          amount: payoutAmount,
          platform_fee: platformFee,
          status: "pending",
        })
        .select("*")
        .single();

      if (insertError || !payoutRequest) {
        throw new Error(
          "Could not create payout request",
        );
      }

      await sb
        .from("orders")
        .update({
          payout_status: "requested",
        })
        .eq("id", order.id);

      return json({
        request: payoutRequest,
      });
    }

    if (action === "seller_payout_requests") {
      const { data, error } = await sb
        .from("payout_requests")
        .select("*")
        .eq("seller_id", user.id)
        .order("requested_at", {
          ascending: false,
        });

      if (error) {
        throw new Error(
          "Could not load payout requests",
        );
      }

      return json({
        requests: data || [],
      });
    }

    // -----------------------------------------------------------------------
    // ADMIN PAYOUT CONTROL
    // Admin marks delivery, reviews requests, and decides when to transfer.
    // -----------------------------------------------------------------------
    if (action === "admin_mark_delivered") {
      requireAdmin(profile);

      const delayHoursRaw =
        body.delayHours ??
        DEFAULT_PAYOUT_DELAY_HOURS;

      const delayHours =
        Number(delayHoursRaw);

      if (
        !Number.isFinite(delayHours) ||
        delayHours < 0 ||
        delayHours > 720
      ) {
        throw new Error(
          "delayHours must be between 0 and 720",
        );
      }

      const { data: order, error } = await sb
        .from("orders")
        .select("*")
        .eq("id", body.orderId)
        .single();

      if (error || !order) {
        throw new Error("Order not found");
      }

      await verifyOrderPayment(order);

      const deliveredAt =
        new Date();

      const payoutEligibleAt =
        new Date(
          deliveredAt.getTime() +
            delayHours *
              60 *
              60 *
              1000,
        );

      const { error: updateError } =
        await sb
          .from("orders")
          .update({
            status: "delivered",
            delivered_at:
              deliveredAt.toISOString(),
            payout_eligible_at:
              payoutEligibleAt.toISOString(),
          })
          .eq("id", order.id);

      if (updateError) {
        throw new Error(
          "Could not mark order delivered",
        );
      }

      return json({
        delivered: true,
        deliveredAt:
          deliveredAt.toISOString(),
        payoutEligibleAt:
          payoutEligibleAt.toISOString(),
      });
    }

    if (action === "admin_payout_requests") {
      requireAdmin(profile);

      let query = sb
        .from("payout_requests")
        .select("*")
        .order("requested_at", {
          ascending: false,
        });

      if (body.status) {
        query = query.eq(
          "status",
          String(body.status),
        );
      }

      const { data, error } =
        await query;

      if (error) {
        throw new Error(
          "Could not load payout requests",
        );
      }

      return json({
        requests: data || [],
      });
    }

    if (action === "admin_reject_payout") {
      requireAdmin(profile);

      const {
        data: request,
        error,
      } = await sb
        .from("payout_requests")
        .select("*")
        .eq(
          "id",
          body.payoutRequestId,
        )
        .single();

      if (error || !request) {
        throw new Error(
          "Payout request not found",
        );
      }

      if (request.status === "paid") {
        throw new Error(
          "A paid payout cannot be rejected",
        );
      }

      const reason = String(
        body.reason ||
          "Payout request rejected by admin",
      ).slice(0, 500);

      const {
        error: updateError,
      } = await sb
        .from("payout_requests")
        .update({
          status: "rejected",
          rejection_reason: reason,
          reviewed_at:
            new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", request.id);

      if (updateError) {
        throw new Error(
          "Could not reject payout request",
        );
      }

      await sb
        .from("orders")
        .update({
          payout_status: "rejected",
        })
        .eq(
          "id",
          request.order_id,
        );

      return json({
        rejected: true,
      });
    }

    if (action === "admin_pay_payout") {
      requireStripe();
      requireAdmin(profile);

      const {
        data: request,
        error: requestError,
      } = await sb
        .from("payout_requests")
        .select("*")
        .eq(
          "id",
          body.payoutRequestId,
        )
        .single();

      if (
        requestError ||
        !request
      ) {
        throw new Error(
          "Payout request not found",
        );
      }

      if (
        request.status ===
        "paid"
      ) {
        return json({
          paid: true,
          transferId:
            request.stripe_transfer_id,
          alreadyPaid: true,
        });
      }

      if (
        ![
          "pending",
          "approved",
        ].includes(
          request.status,
        )
      ) {
        throw new Error(
          `Payout request cannot be paid while status is ${request.status}`,
        );
      }

      const {
        data: order,
        error: orderError,
      } = await sb
        .from("orders")
        .select("*")
        .eq(
          "id",
          request.order_id,
        )
        .single();

      if (
        orderError ||
        !order
      ) {
        throw new Error(
          "Order not found",
        );
      }

      // Never transfer seller money unless Stripe confirms buyer payment.
      const checkoutSession =
        await verifyOrderPayment(
          order,
        );

      if (
        ![
          "delivered",
          "completed",
        ].includes(
          String(
            order.status ||
              "",
          ),
        )
      ) {
        throw new Error(
          "Order must be delivered before payout can be released",
        );
      }

      if (
        !order.payout_eligible_at
      ) {
        throw new Error(
          "Payout eligibility time has not been set for this order",
        );
      }

      const eligibleAt =
        new Date(
          order.payout_eligible_at,
        );

      if (
        Number.isNaN(
          eligibleAt.getTime(),
        ) ||
        eligibleAt.getTime() >
          Date.now()
      ) {
        throw new Error(
          `Payout is not eligible until ${order.payout_eligible_at}`,
        );
      }

      const seller =
        await getProfile(
          request.seller_id,
        );

      if (
        !seller.stripe_account_id ||
        !seller.stripe_onboarding_complete ||
        !seller.payouts_enabled
      ) {
        throw new Error(
          "Seller financial setup is incomplete",
        );
      }

      const connectedAccount =
        await stripe(
          `accounts/${seller.stripe_account_id}`,
        );

      if (
        connectedAccount
          .capabilities
          ?.transfers !==
          "active" ||
        !connectedAccount
          .payouts_enabled
      ) {
        throw new Error(
          "Seller Stripe account cannot currently receive payouts",
        );
      }

      const orderPayoutAmount =
        money(
          Number(
            order
              .seller_payout_amount ||
              0,
          ),
        );

      const requestAmount =
        money(
          Number(
            request.amount ||
              0,
          ),
        );

      if (
        requestAmount <= 0 ||
        orderPayoutAmount <= 0 ||
        requestAmount >
          orderPayoutAmount
      ) {
        throw new Error(
          "Payout amount is invalid",
        );
      }

      let sourceCharge:
        | string
        | null = null;

      if (
        typeof checkoutSession
          .payment_intent ===
        "string"
      ) {
        const paymentIntent =
          await stripe(
            `payment_intents/${checkoutSession.payment_intent}`,
          );

        if (
          typeof paymentIntent
            .latest_charge ===
          "string"
        ) {
          sourceCharge =
            paymentIntent.latest_charge;
        }
      }

      const transferValues: Record<
        string,
        string
      > = {
        amount: String(
          toCents(
            requestAmount,
          ),
        ),
        currency: "usd",
        destination:
          seller.stripe_account_id,
        description:
          `E&T Auctions payout for order ${order.id}`,
        transfer_group:
          `ORDER_${order.id}`,
        "metadata[payout_request_id]":
          request.id,
        "metadata[order_id]":
          order.id,
        "metadata[seller_id]":
          request.seller_id,
      };

      if (sourceCharge) {
        transferValues
          .source_transaction =
          sourceCharge;
      }

      // Idempotency prevents duplicate payout if admin taps twice.
      const transfer =
        await stripe(
          "transfers",
          "POST",
          transferValues,
          `et_payout_${request.id}`,
        );

      const paidAt =
        new Date().toISOString();

      const {
        error:
          payoutUpdateError,
      } = await sb
        .from(
          "payout_requests",
        )
        .update({
          status: "paid",
          stripe_transfer_id:
            transfer.id,
          reviewed_at:
            paidAt,
          reviewed_by:
            user.id,
          paid_at: paidAt,
        })
        .eq(
          "id",
          request.id,
        );

      if (
        payoutUpdateError
      ) {
        throw new Error(
          `Stripe transfer ${transfer.id} succeeded, but payout request could not be updated. Do not pay again; reconcile this transfer in Stripe.`,
        );
      }

      await sb
        .from("orders")
        .update({
          payout_status:
            "paid",
          payout_paid_at:
            paidAt,
        })
        .eq(
          "id",
          order.id,
        );

      return json({
        paid: true,
        transferId:
          transfer.id,
        amount:
          requestAmount,
      });
    }

    // -----------------------------------------------------------------------
    // ADMIN FULL REFUND
    // Refund comes from the platform. If seller was already paid, the code
    // also attempts to reverse that transfer back to the platform.
    // -----------------------------------------------------------------------
    if (
      action ===
      "admin_refund_order"
    ) {
      requireStripe();
      requireAdmin(profile);

      const {
        data: order,
        error: orderError,
      } = await sb
        .from("orders")
        .select("*")
        .eq(
          "id",
          body.orderId,
        )
        .single();

      if (
        orderError ||
        !order
      ) {
        throw new Error(
          "Order not found",
        );
      }

      const checkoutSession =
        await verifyOrderPayment(
          order,
        );

      const paymentIntentId =
        order
          .stripe_payment_intent_id ||
        (
          typeof checkoutSession
            .payment_intent ===
            "string"
            ? checkoutSession
                .payment_intent
            : null
        );

      if (
        !paymentIntentId
      ) {
        throw new Error(
          "Stripe payment intent was not found",
        );
      }

      const refund =
        await stripe(
          "refunds",
          "POST",
          {
            payment_intent:
              paymentIntentId,
            "metadata[order_id]":
              order.id,
          },
          `et_refund_${order.id}`,
        );

      let transferReversalId:
        | string
        | null = null;

      let transferReversalError:
        | string
        | null = null;

      const {
        data: payoutRequest,
      } = await sb
        .from(
          "payout_requests",
        )
        .select("*")
        .eq(
          "order_id",
          order.id,
        )
        .maybeSingle();

      if (
        payoutRequest
          ?.status ===
          "paid" &&
        payoutRequest
          ?.stripe_transfer_id
      ) {
        try {
          const reversal =
            await stripe(
              `transfers/${payoutRequest.stripe_transfer_id}/reversals`,
              "POST",
              {
                "metadata[order_id]":
                  order.id,

                "metadata[payout_request_id]":
                  payoutRequest.id,
              },
              `et_reversal_${payoutRequest.id}`,
            );

          transferReversalId =
            reversal.id;

          await sb
            .from(
              "payout_requests",
            )
            .update({
              status:
                "reversed",

              transfer_reversal_id:
                reversal.id,
            })
            .eq(
              "id",
              payoutRequest.id,
            );
        } catch (error) {
          transferReversalError =
            error instanceof
              Error
              ? error.message
              : "Transfer reversal failed";
        }
      }

      await sb
        .from("orders")
        .update({
          status:
            "refunded",

          payout_status:
            transferReversalId
              ? "reversed"
              : payoutRequest
                    ?.status ===
                  "paid"
                ? "refund_needs_reconciliation"
                : "not_payable",

          refunded_at:
            new Date().toISOString(),

          stripe_refund_id:
            refund.id,
        })
        .eq(
          "id",
          order.id,
        );

      return json({
        refunded: true,
        refundId:
          refund.id,
        transferReversalId,
        transferReversalError,
      });
    }

    return json(
      {
        error:
          "Unknown action",
      },
      400,
    );
  } catch (error) {
    const message =
      error instanceof
        Error
        ? error.message
        : "Unknown error";

    console.error(
      "MARKETPLACE_API_ERROR:",
      message,
    );

    return json(
      {
        error: message,
      },
      400,
    );
  }
});
