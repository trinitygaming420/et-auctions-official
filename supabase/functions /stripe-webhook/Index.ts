import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: cors,
  });

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "";

const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const stripeSecretKey =
  Deno.env.get("STRIPE_SECRET_KEY") || "";

const webhookSecret =
  Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

const sb = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

function requireConfig() {
  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL is not configured",
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
  }

  if (
    !stripeSecretKey ||
    !stripeSecretKey.startsWith("sk_")
  ) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured",
    );
  }

  if (
    !webhookSecret ||
    !webhookSecret.startsWith("whsec_")
  ) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured",
    );
  }
}

async function stripe(
  path: string,
  method = "GET",
  values?: Record<string, string>,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = {
    Authorization:
      `Bearer ${stripeSecretKey}`,
  };

  if (method !== "GET") {
    headers["Content-Type"] =
      "application/x-www-form-urlencoded";
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] =
      idempotencyKey;
  }

  const response = await fetch(
    `https://api.stripe.com/v1/${path}`,
    {
      method,
      headers,
      body:
        method === "GET"
          ? undefined
          : new URLSearchParams(
              values || {},
            ),
    },
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Stripe request failed",
    );
  }

  return data;
}

function toHex(
  buffer: ArrayBuffer,
) {
  return Array.from(
    new Uint8Array(buffer),
  )
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

function safeEqual(
  left: string,
  right: string,
) {
  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  let result = 0;

  for (
    let i = 0;
    i < left.length;
    i++
  ) {
    result |=
      left.charCodeAt(i) ^
      right.charCodeAt(i);
  }

  return result === 0;
}

async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
) {
  const pieces =
    signatureHeader.split(",");

  let timestamp = "";
  const signatures: string[] =
    [];

  for (const piece of pieces) {
    const [key, value] =
      piece.split("=");

    if (
      key === "t" &&
      value
    ) {
      timestamp = value;
    }

    if (
      key === "v1" &&
      value
    ) {
      signatures.push(value);
    }
  }

  if (
    !timestamp ||
    !signatures.length
  ) {
    return false;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber,
    )
  ) {
    return false;
  }

  // Stripe recommends rejecting
  // signatures older than about
  // five minutes.
  const ageSeconds =
    Math.abs(
      Math.floor(
        Date.now() / 1000,
      ) - timestampNumber,
    );

  if (ageSeconds > 300) {
    return false;
  }

  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        webhookSecret,
      ),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    );

  const signedPayload =
    `${timestamp}.${rawBody}`;

  const digest =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        signedPayload,
      ),
    );

  const expected =
    toHex(digest);

  return signatures.some(
    (signature) =>
      safeEqual(
        expected,
        signature,
      ),
  );
}

async function eventAlreadyHandled(
  eventId: string,
) {
  const { data, error } =
    await sb
      .from(
        "stripe_webhook_events",
      )
      .select("id")
      .eq("id", eventId)
      .maybeSingle();

  if (error) {
    throw new Error(
      "Could not check webhook event history",
    );
  }

  return !!data;
}

async function recordEvent(
  eventId: string,
  eventType: string,
) {
  const { error } =
    await sb
      .from(
        "stripe_webhook_events",
      )
      .insert({
        id: eventId,
        type: eventType,
      });

  if (
    error &&
    !String(error.message)
      .toLowerCase()
      .includes("duplicate")
  ) {
    throw new Error(
      "Could not save webhook event",
    );
  }
}

async function getOrder(
  orderId: string,
) {
  const { data, error } =
    await sb
      .from("orders")
      .select(
        `
        id,
        buyer_id,
        seller_id,
        product_id,
        show_id,
        status,
        payout_status,
        paid_at,
        cancelled_at,
        cancel_reason,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        stripe_refund_id
      `,
      )
      .eq("id", orderId)
      .maybeSingle();

  if (error) {
    throw new Error(
      "Could not load order",
    );
  }

  return data;
}

async function getShowStatus(
  showId: string | null,
) {
  if (!showId) {
    return null;
  }

  const { data, error } =
    await sb
      .from("shows")
      .select(
        "id,status",
      )
      .eq("id", showId)
      .maybeSingle();

  if (error) {
    throw new Error(
      "Could not load live show",
    );
  }

  return data?.status
    ? String(
        data.status,
      ).toLowerCase()
    : null;
}

async function refundLatePayment(
  order: any,
  paymentIntentId: string,
) {
  if (
    order.stripe_refund_id
  ) {
    return {
      alreadyRefunded: true,
      refundId:
        order.stripe_refund_id,
    };
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

        "metadata[reason]":
          "payment_after_live_ended",
      },
      `et_late_refund_${order.id}_${paymentIntentId}`,
    );

  const now =
    new Date().toISOString();

  const { error } =
    await sb
      .from("orders")
      .update({
        status: "cancelled",
        payout_status:
          "not_payable",

        cancelled_at:
          order.cancelled_at ||
          now,

        cancel_reason:
          "Buyer did not pay before the live stream ended",

        refunded_at: now,

        stripe_refund_id:
          refund.id,

        stripe_payment_intent_id:
          paymentIntentId,
      })
      .eq("id", order.id);

  if (error) {
    throw new Error(
      `Stripe refund ${refund.id} succeeded but the order could not be updated`,
    );
  }

  return {
    refunded: true,
    refundId: refund.id,
  };
}

async function handleSuccessfulPayment(
  orderId: string,
  paymentIntentId:
    | string
    | null,
) {
  let order =
    await getOrder(
      orderId,
    );

  if (!order) {
    console.log(
      "WEBHOOK_ORDER_NOT_FOUND:",
      orderId,
    );

    return;
  }

  const status =
    String(
      order.status || "",
    ).toLowerCase();

  // Already processed normally.
  if (
    [
      "paid",
      "packed",
      "shipped",
      "delivered",
      "completed",
    ].includes(status)
  ) {
    return;
  }

  const finalPaymentIntentId =
    paymentIntentId ||
    order.stripe_payment_intent_id;

  /*
   * If the sale has already been
   * cancelled, never resurrect it.
   *
   * If Stripe somehow collected the
   * money during a race, refund it.
   */
  if (
    [
      "cancelled",
      "canceled",
      "refunded",
      "failed",
    ].includes(status)
  ) {
    if (
      finalPaymentIntentId &&
      status !== "refunded"
    ) {
      await refundLatePayment(
        order,
        finalPaymentIntentId,
      );
    }

    return;
  }

  if (
    status !== "payment_due"
  ) {
    console.log(
      "WEBHOOK_ORDER_NOT_PAYABLE:",
      order.id,
      status,
    );

    return;
  }

  /*
   * Buyer payment is only valid
   * while the seller's live stream
   * is still running.
   */
  const showStatus =
    await getShowStatus(
      order.show_id,
    );

  if (
    !order.show_id ||
    showStatus !== "live"
  ) {
    if (
      !finalPaymentIntentId
    ) {
      throw new Error(
        "Late Stripe payment did not include a payment intent",
      );
    }

    await refundLatePayment(
      order,
      finalPaymentIntentId,
    );

    return;
  }

  const paidAt =
    new Date().toISOString();

  const updates: Record<
    string,
    unknown
  > = {
    status: "paid",
    payout_status:
      "not_requested",
    paid_at:
      order.paid_at ||
      paidAt,
  };

  if (
    finalPaymentIntentId
  ) {
    updates
      .stripe_payment_intent_id =
      finalPaymentIntentId;
  }

  /*
   * Critical race protection:
   * update ONLY if the order is
   * still payment_due.
   */
  const {
    data: paidOrder,
    error: paidError,
  } = await sb
    .from("orders")
    .update(updates)
    .eq("id", order.id)
    .eq(
      "status",
      "payment_due",
    )
    .select(
      "id,status",
    )
    .maybeSingle();

  if (paidError) {
    throw new Error(
      "Could not record paid order",
    );
  }

  if (paidOrder) {
    console.log(
      "ORDER_MARKED_PAID:",
      order.id,
    );

    return;
  }

  /*
   * The order changed between our
   * read and update. Reload it.
   */
  order =
    await getOrder(
      order.id,
    );

  if (!order) {
    return;
  }

  const latestStatus =
    String(
      order.status || "",
    ).toLowerCase();

  if (
    [
      "paid",
      "packed",
      "shipped",
      "delivered",
      "completed",
    ].includes(
      latestStatus,
    )
  ) {
    return;
  }

  /*
   * End Live won the race.
   * Refund the Stripe payment.
   */
  if (
    [
      "cancelled",
      "canceled",
      "failed",
    ].includes(
      latestStatus,
    )
  ) {
    if (
      !finalPaymentIntentId
    ) {
      throw new Error(
        "Late Stripe payment did not include a payment intent",
      );
    }

    await refundLatePayment(
      order,
      finalPaymentIntentId,
    );

    return;
  }

  throw new Error(
    `Order changed to unexpected status ${latestStatus}`,
  );
}

Deno.serve(
  async (req) => {
    if (
      req.method ===
      "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers: cors,
        },
      );
    }

    if (
      req.method !==
      "POST"
    ) {
      return json(
        {
          error:
            "Method not allowed",
        },
        405,
      );
    }

    try {
      requireConfig();

      /*
       * IMPORTANT:
       * Stripe signature verification
       * MUST use the untouched raw body.
       */
      const rawBody =
        await req.text();

      const signatureHeader =
        req.headers.get(
          "stripe-signature",
        );

      if (
        !signatureHeader
      ) {
        return json(
          {
            error:
              "Missing Stripe signature",
          },
          400,
        );
      }

      const valid =
        await verifyStripeSignature(
          rawBody,
          signatureHeader,
        );

      if (!valid) {
        console.error(
          "INVALID_STRIPE_SIGNATURE",
        );

        return json(
          {
            error:
              "Invalid Stripe signature",
          },
          400,
        );
      }

      const event =
        JSON.parse(rawBody);

      if (
        !event?.id ||
        !event?.type
      ) {
        return json(
          {
            error:
              "Invalid Stripe event",
          },
          400,
        );
      }

      if (
        await eventAlreadyHandled(
          event.id,
        )
      ) {
        return json({
          received: true,
          duplicate: true,
        });
      }

      const object =
        event.data?.object;

      if (!object) {
        await recordEvent(
          event.id,
          event.type,
        );

        return json({
          received: true,
        });
      }

      if (
        event.type ===
          "checkout.session.completed" ||
        event.type ===
          "checkout.session.async_payment_succeeded"
      ) {
        /*
         * completed may arrive before
         * payment for asynchronous
         * methods. Only mark paid when
         * Stripe says payment is paid.
         */
        if (
          object.payment_status ===
          "paid"
        ) {
          const orderId =
            object.metadata
              ?.order_id;

          if (orderId) {
            const paymentIntentId =
              typeof object
                  .payment_intent ===
                "string"
                ? object
                    .payment_intent
                : null;

            await handleSuccessfulPayment(
              orderId,
              paymentIntentId,
            );
          }
        }
      }

      if (
        event.type ===
        "payment_intent.succeeded"
      ) {
        const orderId =
          object.metadata
            ?.order_id;

        if (orderId) {
          await handleSuccessfulPayment(
            orderId,
            object.id || null,
          );
        }
      }

      /*
       * Save the event only AFTER
       * processing succeeds. If
       * processing fails, Stripe can
       * retry the webhook.
       */
      await recordEvent(
        event.id,
        event.type,
      );

      return json({
        received: true,
      });
    } catch (error) {
      const message =
        error instanceof
          Error
          ? error.message
          : "Webhook failed";

      console.error(
        "STRIPE_WEBHOOK_ERROR:",
        message,
      );

      /*
       * Return 500 so Stripe retries
       * temporary processing failures.
       */
      return json(
        {
          error: message,
        },
        500,
      );
    }
  },
);
