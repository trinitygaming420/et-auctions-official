import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { colors as C, money, supabase } from "./config";
import { Button, Empty, Field, Header, Stat, s } from "./ui";

export default function AccountScreen({
  profile,
  setProfile,
  user,
  flash,
}) {
  const [name, setName] = useState(profile?.display_name || "");
  const [page, setPage] = useState("main");
  const [orders, setOrders] = useState([]);
  const [sellerOrders, setSellerOrders] = useState([]);
  const [following, setFollowing] = useState([]);
  const [rating, setRating] = useState(null);
  const [applications, setApplications] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [payoutOrders, setPayoutOrders] = useState({});
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [payoutBusy, setPayoutBusy] = useState(null);

  const [address, setAddress] = useState(
    profile?.shipping_address || {
      name: profile?.display_name || "",
      street1: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
    }
  );

  const orderFields = `
    id,
    buyer_id,
    seller_id,
    subtotal,
    shipping_total,
    total,
    platform_fee,
    seller_payout_amount,
    status,
    payout_status,
    payout_eligible_at,
    delivered_at,
    created_at,
    tracking_number,
    shipping_carrier,
    shipping_label_url,
    stripe_checkout_session_id,
    products(title)
  `;

  const load = useCallback(async () => {
    try {
      const [buyerResult, sellerResult, followingResult, ratingResult] =
        await Promise.all([
          supabase
            .from("orders")
            .select(orderFields)
            .eq("buyer_id", user.id)
            .order("created_at", { ascending: false }),

          supabase
            .from("orders")
            .select(orderFields)
            .eq("seller_id", user.id)
            .order("created_at", { ascending: false }),

          supabase
            .from("follows")
            .select(
              "seller_id,profiles!follows_seller_id_fkey(display_name,seller_approved)"
            )
            .eq("follower_id", user.id),

          supabase
            .from("ratings")
            .select("stars")
            .eq("seller_id", user.id),
        ]);

      if (buyerResult.error) {
        console.log("Buyer orders error:", buyerResult.error.message);
      }

      if (sellerResult.error) {
        console.log("Seller orders error:", sellerResult.error.message);
      }

      if (followingResult.error) {
        console.log("Following error:", followingResult.error.message);
      }

      if (ratingResult.error) {
        console.log("Ratings error:", ratingResult.error.message);
      }

      setOrders(buyerResult.data || []);
      setSellerOrders(sellerResult.data || []);
      setFollowing(followingResult.data || []);

      const stars = ratingResult.data || [];

      setRating(
        stars.length
          ? stars.reduce(
              (sum, item) => sum + Number(item.stars || 0),
              0
            ) / stars.length
          : null
      );

      if (profile?.role === "admin") {
        const applicationsResult = await supabase
          .from("seller_applications")
          .select(
            "user_id,status,profiles!seller_applications_user_id_fkey(display_name)"
          )
          .eq("status", "pending");

        if (applicationsResult.error) {
          console.log(
            "Seller applications error:",
            applicationsResult.error.message
          );
        }

        setApplications(applicationsResult.data || []);

        try {
          const payoutData = await invokeMarketplace({
            action: "admin_payout_requests",
          });

          const requests = payoutData?.requests || [];

          setPayouts(requests);

          const orderIds = [
            ...new Set(
              requests
                .map((item) => item.order_id)
                .filter(Boolean)
            ),
          ];

          if (orderIds.length) {
            const {
              data: payoutOrderRows,
              error: payoutOrdersError,
            } = await supabase
              .from("orders")
              .select(
                "id,total,status,payout_status,payout_eligible_at,delivered_at,products(title)"
              )
              .in("id", orderIds);

            if (payoutOrdersError) {
              console.log(
                "Payout order load error:",
                payoutOrdersError.message
              );
            }

            const nextMap = {};

            for (const row of payoutOrderRows || []) {
              nextMap[row.id] = row;
            }

            setPayoutOrders(nextMap);
          } else {
            setPayoutOrders({});
          }
        } catch (error) {
          console.log(
            "Admin payout load error:",
            error.message
          );

          setPayouts([]);
          setPayoutOrders({});
        }
      } else {
        setApplications([]);
        setPayouts([]);
        setPayoutOrders({});
      }
    } catch (error) {
      console.log(
        "Account load error:",
        error?.message || error
      );
    }
  }, [profile?.role, user.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`account-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => load()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payout_requests",
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, user.id]);

  const saveName = async () => {
    if (!name.trim()) {
      Alert.alert(
        "Name required",
        "Enter the name you want displayed."
      );

      return;
    }

    const { data, error } = await supabase.rpc(
      "save_my_display_name",
      {
        new_name: name.trim(),
      }
    );

    if (error) {
      Alert.alert(
        "Could not save name",
        error.message
      );

      return;
    }

    setProfile(data);

    setName(
      data?.display_name || name.trim()
    );

    flash?.("Name saved");
  };

  const reviewSeller = async (
    application,
    decision
  ) => {
    const { error } = await supabase.rpc(
      "admin_review_seller",
      {
        target_user: application.user_id,
        decision,
      }
    );

    if (error) {
      Alert.alert(
        "Approval failed",
        error.message
      );

      return;
    }

    flash?.(
      decision === "approved"
        ? "Seller approved"
        : "Seller declined"
    );

    await load();
  };

  const setAddressField = (
    key,
    value
  ) => {
    setAddress((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const saveAddress = async () => {
    const { error } = await supabase.rpc(
      "save_my_shipping_address",
      {
        address_data: address,
      }
    );

    if (error) {
      Alert.alert(
        "Could not save address",
        error.message
      );

      return;
    }

    setProfile((current) => ({
      ...current,
      shipping_address: address,
    }));

    flash?.(
      "Shipping address saved"
    );
  };

  const connectStripe = async () => {
    setStripeBusy(true);

    try {
      const data =
        await invokeMarketplace({
          action: "connect_onboarding",
        });

      if (!data?.url) {
        throw new Error(
          "Stripe did not return a financial setup link."
        );
      }

      await Linking.openURL(
        data.url
      );
    } catch (error) {
      Alert.alert(
        "Financial setup failed",
        error.message
      );
    } finally {
      setStripeBusy(false);
    }
  };

  const refreshStripe = useCallback(
    async (showMessage = true) => {
      setStripeBusy(true);

      try {
        const data =
          await invokeMarketplace({
            action: "connect_status",
          });

        setStripeStatus(data);

        setProfile((current) => ({
          ...current,
          stripe_onboarding_complete:
            !!data.complete,
          payouts_enabled:
            !!data.payoutsEnabled,
        }));

        if (showMessage) {
          Alert.alert(
            data.complete
              ? "Financial setup ready"
              : "Setup incomplete",
            data.complete
              ? "Your Stripe account is ready to receive approved seller payouts."
              : data.currentlyDue?.length
              ? `${data.currentlyDue.length} Stripe requirement(s) still need attention.`
              : "Stripe has not fully enabled this seller account yet."
          );
        }
      } catch (error) {
        if (showMessage) {
          Alert.alert(
            "Could not check setup",
            error.message
          );
        }
      } finally {
        setStripeBusy(false);
      }
    },
    [setProfile]
  );

  useEffect(() => {
    if (page !== "sellerSetup") {
      return;
    }

    refreshStripe(false);

    const listener =
      AppState.addEventListener(
        "change",
        (state) => {
          if (state === "active") {
            refreshStripe(false);
          }
        }
      );

    return () => listener.remove();
  }, [page, refreshStripe]);

  const markDelivered = async (
    payout
  ) => {
    setPayoutBusy(payout.id);

    try {
      const data =
        await invokeMarketplace({
          action:
            "admin_mark_delivered",
          orderId: payout.order_id,
          delayHours: 48,
        });

      flash?.(
        "Order marked delivered"
      );

      Alert.alert(
        "Delivery confirmed",
        `Seller payout becomes eligible on ${new Date(
          data.payoutEligibleAt
        ).toLocaleString()}.`
      );

      await load();
    } catch (error) {
      Alert.alert(
        "Could not confirm delivery",
        error.message
      );
    } finally {
      setPayoutBusy(null);
    }
  };

  const paySeller = (payout) => {
    Alert.alert(
      "Pay seller?",
      `Transfer ${money(
        payout.amount
      )} to this seller?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Pay seller",
          onPress: async () => {
            setPayoutBusy(
              payout.id
            );

            try {
              const data =
                await invokeMarketplace({
                  action:
                    "admin_pay_payout",
                  payoutRequestId:
                    payout.id,
                });

              Alert.alert(
                "Payout sent",
                `${money(
                  data?.amount ||
                    payout.amount
                )} was transferred to the seller.`
              );

              flash?.(
                "Seller payout sent"
              );

              await load();
            } catch (error) {
              Alert.alert(
                "Payout failed",
                error.message
              );
            } finally {
              setPayoutBusy(null);
            }
          },
        },
      ]
    );
  };

  const rejectPayout = (
    payout
  ) => {
    Alert.alert(
      "Reject payout?",
      "This payout request will be rejected.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            setPayoutBusy(
              payout.id
            );

            try {
              await invokeMarketplace({
                action:
                  "admin_reject_payout",
                payoutRequestId:
                  payout.id,
                reason:
                  "Payout request rejected by administrator",
              });

              flash?.(
                "Payout rejected"
              );

              await load();
            } catch (error) {
              Alert.alert(
                "Could not reject payout",
                error.message
              );
            } finally {
              setPayoutBusy(null);
            }
          },
        },
      ]
    );
  };

  if (page !== "main") {
    const titles = {
      orders: "MY ORDERS",
      shipping: "PACK & SHIP",
      sellerSetup:
        "FINANCIAL SETUP",
      address:
        "SHIPPING ADDRESS",
      following: "FOLLOWING",
      approvals:
        "SELLER APPROVALS",
      payouts:
        "SELLER PAYOUTS",
    };

    return (
      <SubPage
        title={titles[page]}
        back={() =>
          setPage("main")
        }
      >
        {page === "orders" &&
          (!orders.length ? (
            <Empty title="No orders yet" />
          ) : (
            orders.map(
              (order) => (
                <BuyerOrder
                  key={order.id}
                  order={order}
                  refresh={load}
                />
              )
            )
          ))}

        {page === "shipping" &&
          (!sellerOrders.length ? (
            <Empty title="No seller orders yet" />
          ) : (
            sellerOrders.map(
              (order) => (
                <SellerOrder
                  key={order.id}
                  order={order}
                  refresh={load}
                />
              )
            )
          ))}

        {page ===
          "sellerSetup" && (
          <View style={s.panel}>
            <Text style={s.section}>
              Stripe financial setup
            </Text>

            <Text style={s.muted}>
              Stripe securely collects
              your bank, tax, and
              identity information.
              Buyer payments are
              collected by E&T Auctions.
              Approved seller payouts
              are later transferred to
              the seller's connected
              Stripe account.
            </Text>

            <Stat
              label="Identity details"
              value={
                stripeStatus
                  ?.detailsSubmitted ||
                profile
                  ?.stripe_onboarding_complete
                  ? "Submitted"
                  : "Required"
              }
            />

            <Stat
              label="Transfer capability"
              value={
                stripeStatus
                  ?.transfersEnabled
                  ? "Enabled"
                  : "Not enabled"
              }
            />

            <Stat
              label="Seller payouts"
              value={
                stripeStatus
                  ?.payoutsEnabled ||
                profile
                  ?.payouts_enabled
                  ? "Enabled"
                  : "Not enabled"
              }
            />

            {stripeStatus
              ?.disabledReason && (
              <Text
                style={{
                  color: C.red,
                  marginTop: 8,
                }}
              >
                Stripe status:{" "}
                {String(
                  stripeStatus.disabledReason
                ).replaceAll(
                  "_",
                  " "
                )}
              </Text>
            )}

            {stripeStatus
              ?.currentlyDue
              ?.length >
              0 && (
              <View
                style={s.warning}
              >
                <Text
                  style={s.title}
                >
                  Information still
                  required
                </Text>

                <Text
                  style={s.muted}
                >
                  {stripeStatus.currentlyDue
                    .map((item) =>
                      String(item)
                        .split(".")
                        .pop()
                        .replaceAll(
                          "_",
                          " "
                        )
                    )
                    .join(", ")}
                </Text>
              </View>
            )}

            <Button
              disabled={
                stripeBusy
              }
              title={
                stripeBusy
                  ? "Opening Stripe..."
                  : profile
                      ?.stripe_onboarding_complete
                  ? "Review financial setup"
                  : "Start financial setup"
              }
              onPress={
                connectStripe
              }
            />

            <Button
              ghost
              disabled={
                stripeBusy
              }
              title={
                stripeBusy
                  ? "Checking..."
                  : "Refresh setup status"
              }
              onPress={() =>
                refreshStripe(true)
              }
            />
          </View>
        )}

        {page === "address" && (
          <View style={s.panel}>
            <Text style={s.section}>
              Shipping address
            </Text>

            <Text style={s.muted}>
              Buyers use this as their
              delivery address. Sellers
              use it as the return
              address for shipping
              labels.
            </Text>

            <Field
              label="Full name"
              value={
                address.name || ""
              }
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "name",
                  value
                )
              }
            />

            <Field
              label="Street address"
              value={
                address.street1 || ""
              }
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "street1",
                  value
                )
              }
            />

            <Field
              label="City"
              value={
                address.city || ""
              }
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "city",
                  value
                )
              }
            />

            <Field
              label="State"
              value={
                address.state || ""
              }
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "state",
                  value
                )
              }
            />

            <Field
              label="ZIP code"
              value={
                address.zip || ""
              }
              keyboardType="number-pad"
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "zip",
                  value
                )
              }
            />

            <Field
              label="Phone"
              value={
                address.phone || ""
              }
              keyboardType="phone-pad"
              onChangeText={(
                value
              ) =>
                setAddressField(
                  "phone",
                  value
                )
              }
            />

            <Button
              title="Save shipping address"
              onPress={
                saveAddress
              }
            />
          </View>
        )}

        {page ===
          "following" &&
          (!following.length ? (
            <Empty title="You are not following sellers yet" />
          ) : (
            following.map(
              (item) => (
                <View
                  key={
                    item.seller_id
                  }
                  style={
                    s.activity
                  }
                >
                  <Text
                    style={{
                      fontSize: 24,
                      color:
                        C.orange,
                    }}
                  >
                    ●
                  </Text>

                  <Text
                    style={[
                      s.title,
                      {
                        flex: 1,
                      },
                    ]}
                  >
                    {item.profiles
                      ?.display_name ||
                      "Seller"}
                  </Text>

                  {item.profiles
                    ?.seller_approved && (
                    <Text
                      style={
                        s.badge
                      }
                    >
                      ✓ VERIFIED
                    </Text>
                  )}
                </View>
              )
            )
          ))}

        {page ===
          "approvals" &&
          (!applications.length ? (
            <Empty title="No seller requests waiting" />
          ) : (
            applications.map(
              (application) => (
                <View
                  key={
                    application.user_id
                  }
                  style={
                    s.panel
                  }
                >
                  <Text
                    style={
                      s.title
                    }
                  >
                    {application
                      .profiles
                      ?.display_name ||
                      "Seller"}
                  </Text>

                  <Text
                    style={
                      s.muted
                    }
                  >
                    Seller application
                    pending
                  </Text>

                  <View
                    style={s.row}
                  >
                    <Button
                      small
                      title="Approve"
                      onPress={() =>
                        reviewSeller(
                          application,
                          "approved"
                        )
                      }
                    />

                    <Button
                      small
                      danger
                      title="Decline"
                      onPress={() =>
                        reviewSeller(
                          application,
                          "declined"
                        )
                      }
                    />
                  </View>
                </View>
              )
            )
          ))}

        {page === "payouts" &&
          (!payouts.length ? (
            <Empty title="No payout requests" />
          ) : (
            payouts.map(
              (payout) => (
                <AdminPayoutCard
                  key={payout.id}
                  payout={payout}
                  order={
                    payoutOrders[
                      payout.order_id
                    ]
                  }
                  busy={
                    payoutBusy ===
                    payout.id
                  }
                  onDelivered={
                    markDelivered
                  }
                  onPay={
                    paySeller
                  }
                  onReject={
                    rejectPayout
                  }
                />
              )
            )
          ))}
      </SubPage>
    );
  }

  const pendingPayouts =
    payouts.filter((item) =>
      [
        "pending",
        "approved",
      ].includes(
        String(
          item.status || ""
        ).toLowerCase()
      )
    ).length;

  const shippingCount =
    sellerOrders.filter((order) =>
      [
        "paid",
        "packed",
      ].includes(
        String(
          order.status || ""
        ).toLowerCase()
      )
    ).length;

  return (
    <ScrollView
      contentContainerStyle={
        s.page
      }
    >
      <Header
        title="ACCOUNT"
        subtitle={user.email}
        profile={profile}
      />

      <View
        style={[
          s.panel,
          s.row,
        ]}
      >
        <View
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            borderWidth: 2,
            borderColor:
              C.orange,
            alignItems:
              "center",
            justifyContent:
              "center",
          }}
        >
          <Text
            style={{
              color:
                C.orange,
              fontSize: 23,
              fontWeight:
                "900",
            }}
          >
            {(
              profile
                ?.display_name ||
              "ET"
            )
              .slice(0, 2)
              .toUpperCase()}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
          }}
        >
          <Text
            style={s.logo}
          >
            {profile
              ?.display_name ||
              "E&T User"}
          </Text>

          {profile
            ?.seller_approved ? (
            <Text
              style={s.badge}
            >
              ✓ VERIFIED SELLER
            </Text>
          ) : (
            <Text
              style={s.muted}
            >
              Buyer account
            </Text>
          )}

          {profile?.role ===
            "admin" && (
            <Text
              style={[
                s.badge,
                {
                  marginTop: 5,
                },
              ]}
            >
              ADMINISTRATOR
            </Text>
          )}

          <Text
            style={s.muted}
          >
            {rating
              ? `${rating.toFixed(
                  1
                )} ★ seller rating`
              : "No seller ratings yet"}
          </Text>
        </View>
      </View>

      <View style={s.panel}>
        <Field
          label="Display name"
          value={name}
          onChangeText={
            setName
          }
        />

        <Button
          title="Save name"
          onPress={
            saveName
          }
        />
      </View>

      <Link
        icon="📍"
        title="Shipping address"
        value={
          profile
            ?.shipping_address
            ? "Saved"
            : "Required"
        }
        onPress={() =>
          setPage("address")
        }
      />

      <Link
        icon="📦"
        title="My orders"
        value={
          orders.length
        }
        onPress={() =>
          setPage("orders")
        }
      />

      {profile
        ?.seller_approved && (
        <>
          <Link
            icon="$"
            title="Financial setup"
            value={
              profile
                ?.payouts_enabled
                ? "Ready"
                : "Required"
            }
            onPress={() =>
              setPage(
                "sellerSetup"
              )
            }
          />

          <Link
            icon="🚚"
            title="Pack and ship orders"
            value={
              shippingCount
            }
            onPress={() =>
              setPage(
                "shipping"
              )
            }
          />
        </>
      )}

      <Link
        icon="♥"
        title="Following"
        value={
          following.length
        }
        onPress={() =>
          setPage("following")
        }
      />

      <Link
        icon="★"
        title="Ratings"
        value={
          rating
            ? rating.toFixed(1)
            : "—"
        }
      />

      {profile?.role ===
        "admin" && (
        <>
          <Text
            style={s.section}
          >
            Administrator controls
          </Text>

          <Link
            icon="✓"
            title="Seller approvals"
            value={
              applications.length
            }
            onPress={() =>
              setPage(
                "approvals"
              )
            }
          />

          <Link
            icon="$"
            title="Seller payouts"
            value={
              pendingPayouts
            }
            onPress={() =>
              setPage(
                "payouts"
              )
            }
          />
        </>
      )}

      <Button
        danger
        title="Sign out"
        onPress={() =>
          supabase.auth.signOut()
        }
      />
    </ScrollView>
  );
}

function AdminPayoutCard({
  payout,
  order,
  busy,
  onDelivered,
  onPay,
  onReject,
}) {
  const requestStatus =
    String(
      payout.status || ""
    ).toLowerCase();

  const orderStatus =
    String(
      order?.status || ""
    ).toLowerCase();

  const eligibleDate =
    order?.payout_eligible_at
      ? new Date(
          order.payout_eligible_at
        )
      : null;

  const eligibleNow =
    eligibleDate &&
    !Number.isNaN(
      eligibleDate.getTime()
    ) &&
    eligibleDate.getTime() <=
      Date.now();

  const delivered =
    orderStatus ===
      "delivered" ||
    orderStatus ===
      "completed";

  return (
    <View style={s.panel}>
      <Text style={s.title}>
        {order?.products
          ?.title ||
          "Seller payout request"}
      </Text>

      <Text style={s.muted}>
        Order{" "}
        {String(
          payout.order_id || ""
        ).slice(0, 8)}
      </Text>

      <Stat
        label="Order total"
        value={money(
          order?.total || 0
        )}
      />

      <Stat
        label="E&T 5% fee"
        value={money(
          payout.platform_fee ||
            0
        )}
      />

      <Stat
        label="Seller receives"
        value={money(
          payout.amount || 0
        )}
      />

      <Stat
        label="Order status"
        value={
          orderStatus ||
          "unknown"
        }
      />

      <Stat
        label="Payout status"
        value={
          requestStatus ||
          "unknown"
        }
      />

      {eligibleDate && (
        <Text
          style={[
            s.muted,
            {
              marginTop: 7,
            },
          ]}
        >
          Eligible:{" "}
          {eligibleDate.toLocaleString()}
        </Text>
      )}

      {requestStatus ===
        "paid" && (
        <Text
          style={{
            color:
              C.green,
            fontWeight:
              "900",
            marginTop: 8,
          }}
        >
          ✓ PAID TO SELLER
        </Text>
      )}

      {requestStatus ===
        "rejected" && (
        <Text
          style={{
            color:
              C.red,
            marginTop: 8,
          }}
        >
          Rejected
          {payout.rejection_reason
            ? `: ${payout.rejection_reason}`
            : ""}
        </Text>
      )}

      {[
        "pending",
        "approved",
      ].includes(
        requestStatus
      ) && (
        <>
          {!delivered && (
            <Button
              disabled={busy}
              title={
                busy
                  ? "Updating..."
                  : "Confirm delivery"
              }
              onPress={() =>
                onDelivered(
                  payout
                )
              }
            />
          )}

          {delivered &&
            !eligibleNow && (
              <Text
                style={[
                  s.muted,
                  {
                    marginTop: 8,
                  },
                ]}
              >
                Payout is held until
                the eligibility time.
              </Text>
            )}

          {delivered &&
            eligibleNow && (
              <Button
                disabled={busy}
                title={
                  busy
                    ? "Sending..."
                    : `Pay seller ${money(
                        payout.amount
                      )}`
                }
                onPress={() =>
                  onPay(payout)
                }
              />
            )}

          <Button
            danger
            ghost
            disabled={busy}
            title="Reject payout"
            onPress={() =>
              onReject(payout)
            }
          />
        </>
      )}
    </View>
  );
}

function BuyerOrder({
  order,
  refresh,
}) {
  const checkout = async () => {
    try {
      const data =
        await invokeMarketplace({
          action:
            "create_checkout",
          orderId:
            order.id,
        });

      if (
        data?.alreadyPaid
      ) {
        Alert.alert(
          "Already paid",
          "This order has already been paid."
        );

        await refresh();

        return;
      }

      if (!data?.url) {
        throw new Error(
          "Stripe checkout link was not returned."
        );
      }

      await Linking.openURL(
        data.url
      );
    } catch (error) {
      Alert.alert(
        "Checkout failed",
        error.message
      );
    }
  };

  const verifyPayment =
    async () => {
      try {
        const data =
          await invokeMarketplace({
            action:
              "verify_checkout",
            orderId:
              order.id,
          });

        Alert.alert(
          data?.paid
            ? "Payment received"
            : "Payment not completed",
          data?.paid
            ? "Your payment was confirmed. The seller can now prepare the order."
            : "Complete Stripe checkout and then check again."
        );

        await refresh();
      } catch (error) {
        Alert.alert(
          "Could not verify payment",
          error.message
        );
      }
    };

  const track = () => {
    if (
      !order.tracking_number
    ) {
      return;
    }

    Linking.openURL(
      `https://www.google.com/search?q=${encodeURIComponent(
        `${
          order.shipping_carrier ||
          "carrier"
        } tracking ${
          order.tracking_number
        }`
      )}`
    );
  };

  return (
    <View style={s.panel}>
      <View
        style={s.between}
      >
        <Text
          style={s.title}
        >
          {order.products
            ?.title ||
            "Order"}
        </Text>

        <Text
          style={s.price}
        >
          {money(
            order.total
          )}
        </Text>
      </View>

      <Text style={s.muted}>
        Status:{" "}
        {String(
          order.status ||
            "unknown"
        ).replaceAll(
          "_",
          " "
        )}
      </Text>

      {order.status ===
        "payment_due" && (
        <>
          <Button
            title="Calculate shipping & pay"
            onPress={
              checkout
            }
          />

          <Button
            ghost
            title="I paid — check payment"
            onPress={
              verifyPayment
            }
          />
        </>
      )}

      {order
        .tracking_number && (
        <>
          <Text
            style={s.text}
          >
            {order
              .shipping_carrier ||
              "Carrier"}
            :{" "}
            {
              order.tracking_number
            }
          </Text>

          <Button
            ghost
            title="Track package"
            onPress={
              track
            }
          />
        </>
      )}
    </View>
  );
}

function SellerOrder({
  order,
  refresh,
}) {
  const markPacked =
    async () => {
      const { error } =
        await supabase.rpc(
          "seller_pack_order",
          {
            target_order:
              order.id,
          }
        );

      if (error) {
        Alert.alert(
          "Could not pack order",
          error.message
        );

        return;
      }

      await refresh();
    };

  const buyLabel =
    async () => {
      try {
        const data =
          await invokeMarketplace({
            action:
              "buy_label",
            orderId:
              order.id,
          });

        if (!data?.labelUrl) {
          throw new Error(
            "Shipping label URL was not returned."
          );
        }

        await refresh();

        await Linking.openURL(
          data.labelUrl
        );
      } catch (error) {
        Alert.alert(
          "Label failed",
          error.message
        );
      }
    };

  return (
    <View style={s.panel}>
      <View
        style={s.between}
      >
        <Text
          style={s.title}
        >
          {order.products
            ?.title ||
            "Order"}
        </Text>

        <Text
          style={s.price}
        >
          {money(
            order.total
          )}
        </Text>
      </View>

      <Text style={s.muted}>
        Status:{" "}
        {String(
          order.status ||
            "unknown"
        ).replaceAll(
          "_",
          " "
        )}
      </Text>

      {Number(
        order.seller_payout_amount ||
          0
      ) > 0 && (
        <>
          <Text
            style={s.muted}
          >
            Seller receives:{" "}
            {money(
              order.seller_payout_amount
            )}
          </Text>

          <Text
            style={s.muted}
          >
            E&T fee:{" "}
            {money(
              order.platform_fee
            )}
          </Text>
        </>
      )}

      {order.status ===
        "paid" && (
        <Button
          title="Mark packed"
          onPress={
            markPacked
          }
        />
      )}

      {order.status ===
        "packed" && (
        <Button
          title="Purchase & print prepaid label"
          onPress={
            buyLabel
          }
        />
      )}

      {order
        .shipping_label_url && (
        <Button
          ghost
          title="Open shipping label"
          onPress={() =>
            Linking.openURL(
              order.shipping_label_url
            )
          }
        />
      )}
    </View>
  );
}

function Link({
  icon,
  title,
  value,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        s.activity,
        {
          minHeight: 60,
        },
      ]}
    >
      <Text
        style={{
          fontSize: 21,
          color: C.orange,
          width: 28,
        }}
      >
        {icon}
      </Text>

      <Text
        style={[
          s.title,
          {
            flex: 1,
          },
        ]}
      >
        {title}
      </Text>

      <Text
        style={s.muted}
      >
        {value} ›
      </Text>
    </Pressable>
  );
}

function SubPage({
  title,
  back,
  children,
}) {
  return (
    <ScrollView
      contentContainerStyle={
        s.page
      }
    >
      <View
        style={
          s.modalHeader
        }
      >
        <Pressable
          onPress={back}
        >
          <Text
            style={s.back}
          >
            ‹
          </Text>
        </Pressable>

        <Text
          style={s.logo}
        >
          {title}
        </Text>
      </View>

      {children}
    </ScrollView>
  );
}

async function invokeMarketplace(
  body
) {
  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      "marketplace-api",
      {
        body,
      }
    );

  if (error) {
    let message =
      error.message ||
      "Marketplace service failed";

    try {
      const details =
        await error.context.json();

      message =
        details?.error ||
        message;
    } catch {}

    throw new Error(
      message
    );
  }

  if (data?.error) {
    throw new Error(
      data.error
    );
  }

  return data;
}
