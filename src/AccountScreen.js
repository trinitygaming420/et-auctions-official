import React, {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  colors as C,
  money,
  supabase,
} from "./config";

import {
  Button,
  Empty,
  Field,
  Header,
  Stat,
  s,
} from "./ui";

async function invokeMarketplace(body) {
  const {
    data,
    error,
  } = await supabase.functions.invoke(
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

    throw new Error(message);
  }

  if (data?.error) {
    throw new Error(
      data.error
    );
  }

  return data;
}

async function addProductTitles(rows) {
  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return [];
  }

  const ids = [
    ...new Set(
      rows
        .map(
          (row) =>
            row.product_id
        )
        .filter(Boolean)
    ),
  ];

  if (!ids.length) {
    return rows;
  }

  const {
    data,
    error,
  } = await supabase
    .from("products")
    .select("id,title")
    .in("id", ids);

  if (error) {
    console.log(
      "PRODUCT_TITLE_ERROR:",
      error.message
    );

    return rows;
  }

  const byId = {};

  for (
    const product of
    data || []
  ) {
    byId[product.id] =
      product;
  }

  return rows.map(
    (row) => ({
      ...row,

      products:
        byId[row.product_id] ||
        null,
    })
  );
}

export default function AccountScreen({
  profile,
  setProfile,
  user,
  flash,
}) {
  const [
    page,
    setPage,
  ] = useState("main");

  const [
    name,
    setName,
  ] = useState(
    profile?.display_name ||
      ""
  );

  const [
    orders,
    setOrders,
  ] = useState([]);

  const [
    sellerOrders,
    setSellerOrders,
  ] = useState([]);

  const [
    sellerPayoutRequests,
    setSellerPayoutRequests,
  ] = useState([]);

  const [
    following,
    setFollowing,
  ] = useState([]);

  const [
    rating,
    setRating,
  ] = useState(null);

  const [
    applications,
    setApplications,
  ] = useState([]);

  const [
    adminPayouts,
    setAdminPayouts,
  ] = useState([]);

  const [
    payoutOrders,
    setPayoutOrders,
  ] = useState({});

  const [
    stripeBusy,
    setStripeBusy,
  ] = useState(false);

  const [
    stripeStatus,
    setStripeStatus,
  ] = useState(null);

  const [
    payoutBusy,
    setPayoutBusy,
  ] = useState(null);

  const [
    address,
    setAddress,
  ] = useState(
    profile
      ?.shipping_address || {
      name:
        profile
          ?.display_name ||
        "",
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
    product_id,
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
    stripe_checkout_session_id
  `;

  const load =
    useCallback(
      async () => {
        try {
          const [
            buyerResult,
            sellerResult,
            followingResult,
            ratingResult,
          ] =
            await Promise.all([
              supabase
                .from("orders")
                .select(
                  orderFields
                )
                .eq(
                  "buyer_id",
                  user.id
                )
                .neq(
                  "status",
                  "cancelled"
                )
                .order(
                  "created_at",
                  {
                    ascending:
                      false,
                  }
                ),

              supabase
                .from("orders")
                .select(
                  orderFields
                )
                .eq(
                  "seller_id",
                  user.id
                )
                .in(
                  "status",
                  [
                    "paid",
                    "packed",
                    "shipped",
                    "delivered",
                    "completed",
                  ]
                )
                .order(
                  "created_at",
                  {
                    ascending:
                      false,
                  }
                ),

              supabase
                .from("follows")
                .select(
                  "seller_id,profiles!follows_seller_id_fkey(display_name,seller_approved)"
                )
                .eq(
                  "follower_id",
                  user.id
                ),

              supabase
                .from("ratings")
                .select("stars")
                .eq(
                  "seller_id",
                  user.id
                ),
            ]);

          if (
            buyerResult.error
          ) {
            console.log(
              "BUYER_ORDER_ERROR:",
              buyerResult.error
                .message
            );
          }

          if (
            sellerResult.error
          ) {
            console.log(
              "SELLER_ORDER_ERROR:",
              sellerResult.error
                .message
            );
          }

          const buyerRows =
            await addProductTitles(
              buyerResult.data ||
                []
            );

          const sellerRows =
            await addProductTitles(
              sellerResult.data ||
                []
            );

          setOrders(
            buyerRows
          );

          setSellerOrders(
            sellerRows
          );

          setFollowing(
            followingResult.data ||
              []
          );

          const stars =
            ratingResult.data ||
            [];

          setRating(
            stars.length
              ? stars.reduce(
                  (
                    sum,
                    item
                  ) =>
                    sum +
                    Number(
                      item.stars ||
                        0
                    ),
                  0
                ) /
                stars.length
              : null
          );

          if (
            profile
              ?.seller_approved
          ) {
            try {
              const payoutData =
                await invokeMarketplace(
                  {
                    action:
                      "seller_payout_requests",
                  }
                );

              setSellerPayoutRequests(
                payoutData
                  ?.requests ||
                  []
              );
            } catch (
              error
            ) {
              console.log(
                "SELLER_PAYOUT_LOAD_ERROR:",
                error.message
              );

              setSellerPayoutRequests(
                []
              );
            }
          } else {
            setSellerPayoutRequests(
              []
            );
          }

          if (
            profile?.role ===
            "admin"
          ) {
            const {
              data:
                applicationRows,
              error:
                applicationError,
            } =
              await supabase
                .from(
                  "seller_applications"
                )
                .select(
                  "user_id,status,profiles!seller_applications_user_id_fkey(display_name)"
                )
                .eq(
                  "status",
                  "pending"
                );

            if (
              applicationError
            ) {
              console.log(
                "APPLICATION_ERROR:",
                applicationError
                  .message
              );
            }

            setApplications(
              applicationRows ||
                []
            );

            try {
              const payoutData =
                await invokeMarketplace(
                  {
                    action:
                      "admin_payout_requests",
                  }
                );

              const requests =
                payoutData
                  ?.requests ||
                [];

              setAdminPayouts(
                requests
              );

              const ids = [
                ...new Set(
                  requests
                    .map(
                      (item) =>
                        item.order_id
                    )
                    .filter(Boolean)
                ),
              ];

              if (
                ids.length
              ) {
                const {
                  data:
                    rows,
                } =
                  await supabase
                    .from(
                      "orders"
                    )
                    .select(
                      `
                      id,
                      product_id,
                      total,
                      status,
                      payout_status,
                      payout_eligible_at,
                      delivered_at
                      `
                    )
                    .in(
                      "id",
                      ids
                    );

                const enriched =
                  await addProductTitles(
                    rows || []
                  );

                const nextMap =
                  {};

                for (
                  const row of
                  enriched
                ) {
                  nextMap[
                    row.id
                  ] = row;
                }

                setPayoutOrders(
                  nextMap
                );
              } else {
                setPayoutOrders(
                  {}
                );
              }
            } catch (
              error
            ) {
              console.log(
                "ADMIN_PAYOUT_ERROR:",
                error.message
              );

              setAdminPayouts(
                []
              );
            }
          } else {
            setApplications(
              []
            );

            setAdminPayouts(
              []
            );

            setPayoutOrders(
              {}
            );
          }
        } catch (
          error
        ) {
          console.log(
            "ACCOUNT_LOAD_ERROR:",
            error.message
          );
        }
      },
      [
        profile?.role,
        profile
          ?.seller_approved,
        user.id,
      ]
    );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel =
      supabase
        .channel(
          `account-${user.id}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema:
              "public",
            table:
              "orders",
          },
          load
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema:
              "public",
            table:
              "payout_requests",
          },
          load
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [
    load,
    user.id,
  ]);

  const saveName =
    async () => {
      if (
        !name.trim()
      ) {
        Alert.alert(
          "Name required",
          "Enter a display name."
        );

        return;
      }

      const {
        data,
        error,
      } =
        await supabase.rpc(
          "save_my_display_name",
          {
            new_name:
              name.trim(),
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

      flash?.(
        "Name saved"
      );
    };

  const setAddressField =
    (
      key,
      value
    ) => {
      setAddress(
        (current) => ({
          ...current,
          [key]: value,
        })
      );
    };

  const saveAddress =
    async () => {
      const {
        error,
      } =
        await supabase.rpc(
          "save_my_shipping_address",
          {
            address_data:
              address,
          }
        );

      if (error) {
        Alert.alert(
          "Could not save address",
          error.message
        );

        return;
      }

      setProfile(
        (current) => ({
          ...current,

          shipping_address:
            address,
        })
      );

      flash?.(
        "Shipping address saved"
      );
    };

  const connectStripe =
    async () => {
      setStripeBusy(true);

      try {
        const data =
          await invokeMarketplace(
            {
              action:
                "connect_onboarding",
            }
          );

        if (
          !data?.url
        ) {
          throw new Error(
            "Stripe setup link was not returned."
          );
        }

        await Linking.openURL(
          data.url
        );
      } catch (
        error
      ) {
        Alert.alert(
          "Financial setup failed",
          error.message
        );
      } finally {
        setStripeBusy(false);
      }
    };

  const refreshStripe =
    useCallback(
      async (
        showMessage =
          true
      ) => {
        setStripeBusy(true);

        try {
          const data =
            await invokeMarketplace(
              {
                action:
                  "connect_status",
              }
            );

          setStripeStatus(
            data
          );

          setProfile(
            (current) => ({
              ...current,

              stripe_onboarding_complete:
                !!data.complete,

              payouts_enabled:
                !!data
                  .payoutsEnabled,
            })
          );

          if (
            showMessage
          ) {
            Alert.alert(
              data.complete
                ? "Financial setup ready"
                : "Setup incomplete",

              data.complete
                ? "Your seller payout account is ready."
                : "Stripe setup still needs attention."
            );
          }
        } catch (
          error
        ) {
          if (
            showMessage
          ) {
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
    if (
      page !==
      "sellerSetup"
    ) {
      return;
    }

    refreshStripe(false);

    const listener =
      AppState.addEventListener(
        "change",
        (state) => {
          if (
            state ===
            "active"
          ) {
            refreshStripe(
              false
            );
          }
        }
      );

    return () =>
      listener.remove();
  }, [
    page,
    refreshStripe,
  ]);

  const reviewSeller =
    async (
      application,
      decision
    ) => {
      const {
        error,
      } =
        await supabase.rpc(
          "admin_review_seller",
          {
            target_user:
              application.user_id,

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
        decision ===
          "approved"
          ? "Seller approved"
          : "Seller declined"
      );

      await load();
    };

  const markDelivered =
    async (
      payout
    ) => {
      setPayoutBusy(
        payout.id
      );

      try {
        const data =
          await invokeMarketplace(
            {
              action:
                "admin_mark_delivered",

              orderId:
                payout.order_id,

              delayHours:
                48,
            }
          );

        Alert.alert(
          "Delivery confirmed",
          `Payout becomes eligible ${new Date(
            data.payoutEligibleAt
          ).toLocaleString()}.`
        );

        await load();
      } catch (
        error
      ) {
        Alert.alert(
          "Delivery update failed",
          error.message
        );
      } finally {
        setPayoutBusy(
          null
        );
      }
    };

  const paySeller =
    (payout) => {
      Alert.alert(
        "Pay seller?",
        `Send ${money(
          payout.amount
        )} to this seller?`,
        [
          {
            text:
              "Cancel",
            style:
              "cancel",
          },

          {
            text:
              "Pay seller",

            onPress:
              async () => {
                setPayoutBusy(
                  payout.id
                );

                try {
                  await invokeMarketplace(
                    {
                      action:
                        "admin_pay_payout",

                      payoutRequestId:
                        payout.id,
                    }
                  );

                  Alert.alert(
                    "Payout sent",
                    "Seller payout was transferred."
                  );

                  await load();
                } catch (
                  error
                ) {
                  Alert.alert(
                    "Payout failed",
                    error.message
                  );
                } finally {
                  setPayoutBusy(
                    null
                  );
                }
              },
          },
        ]
      );
    };

  const rejectPayout =
    (payout) => {
      Alert.alert(
        "Reject payout?",
        "The seller will be able to request it again.",
        [
          {
            text:
              "Cancel",
            style:
              "cancel",
          },

          {
            text:
              "Reject",
            style:
              "destructive",

            onPress:
              async () => {
                try {
                  await invokeMarketplace(
                    {
                      action:
                        "admin_reject_payout",

                      payoutRequestId:
                        payout.id,

                      reason:
                        "Rejected by administrator",
                    }
                  );

                  await load();
                } catch (
                  error
                ) {
                  Alert.alert(
                    "Could not reject payout",
                    error.message
                  );
                }
              },
          },
        ]
      );
    };

  const sellerPayoutOrders =
    sellerOrders.filter(
      (order) =>
        [
          "shipped",
          "delivered",
          "completed",
        ].includes(
          String(
            order.status ||
              ""
          ).toLowerCase()
        )
    );

  const shippingCount =
    sellerOrders.filter(
      (order) =>
        [
          "paid",
          "packed",
        ].includes(
          String(
            order.status ||
              ""
          ).toLowerCase()
        )
    ).length;

  const sellerPayoutCount =
    sellerPayoutOrders.filter(
      (order) =>
        String(
          order.payout_status ||
            "not_requested"
        ).toLowerCase() !==
        "paid"
    ).length;

  const pendingAdminPayouts =
    adminPayouts.filter(
      (request) =>
        [
          "pending",
          "approved",
        ].includes(
          String(
            request.status ||
              ""
          ).toLowerCase()
        )
    ).length;

  if (
    page !== "main"
  ) {
    const titles = {
      orders:
        "MY ORDERS",

      shipping:
        "PACK & SHIP",

      sellerPayouts:
        "SELLER PAYOUTS",

      sellerSetup:
        "FINANCIAL SETUP",

      address:
        "SHIPPING ADDRESS",

      following:
        "FOLLOWING",

      approvals:
        "SELLER APPROVALS",

      adminPayouts:
        "ADMIN PAYOUTS",
    };

    return (
      <SubPage
        title={
          titles[page]
        }
        back={() =>
          setPage("main")
        }
      >
        {page ===
          "orders" &&
          (!orders.length ? (
            <Empty title="No orders yet" />
          ) : (
            orders.map(
              (order) => (
                <BuyerOrder
                  key={
                    order.id
                  }
                  order={
                    order
                  }
                  refresh={
                    load
                  }
                />
              )
            )
          ))}

        {page ===
          "shipping" &&
          (!sellerOrders.length ? (
            <Empty title="No seller orders yet" />
          ) : (
            sellerOrders.map(
              (order) => (
                <SellerShippingOrder
                  key={
                    order.id
                  }
                  order={
                    order
                  }
                  refresh={
                    load
                  }
                />
              )
            )
          ))}

        {page ===
          "sellerPayouts" &&
          (!sellerPayoutOrders.length ? (
            <Empty title="No shipped orders waiting for payout" />
          ) : (
            sellerPayoutOrders.map(
              (order) => (
                <SellerPayoutOrder
                  key={
                    order.id
                  }
                  order={
                    order
                  }
                  requests={
                    sellerPayoutRequests
                  }
                  refresh={
                    load
                  }
                  flash={
                    flash
                  }
                />
              )
            )
          ))}

        {page ===
          "sellerSetup" && (
          <View
            style={s.panel}
          >
            <Text
              style={
                s.section
              }
            >
              Stripe financial setup
            </Text>

            <Stat
              label="Identity"
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
              label="Transfers"
              value={
                stripeStatus
                  ?.transfersEnabled
                  ? "Enabled"
                  : "Not enabled"
              }
            />

            <Stat
              label="Payout account"
              value={
                stripeStatus
                  ?.payoutsEnabled ||
                profile
                  ?.payouts_enabled
                  ? "Ready"
                  : "Not ready"
              }
            />

            <Button
              disabled={
                stripeBusy
              }
              title={
                profile
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
              title="Refresh setup status"
              onPress={() =>
                refreshStripe(
                  true
                )
              }
            />
          </View>
        )}

        {page ===
          "address" && (
          <View
            style={s.panel}
          >
            <Field
              label="Full name"
              value={
                address.name ||
                ""
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
                address.street1 ||
                ""
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
                address.city ||
                ""
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
                address.state ||
                ""
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
                address.zip ||
                ""
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
                address.phone ||
                ""
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
                    style={[
                      s.title,
                      {
                        flex: 1,
                      },
                    ]}
                  >
                    {item
                      .profiles
                      ?.display_name ||
                      "Seller"}
                  </Text>
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
              (
                application
              ) => (
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

                  <Button
                    title="Approve"
                    onPress={() =>
                      reviewSeller(
                        application,
                        "approved"
                      )
                    }
                  />

                  <Button
                    danger
                    ghost
                    title="Decline"
                    onPress={() =>
                      reviewSeller(
                        application,
                        "declined"
                      )
                    }
                  />
                </View>
              )
            )
          ))}

        {page ===
          "adminPayouts" &&
          (!adminPayouts.length ? (
            <Empty title="No payout requests" />
          ) : (
            adminPayouts.map(
              (payout) => (
                <AdminPayoutCard
                  key={
                    payout.id
                  }
                  payout={
                    payout
                  }
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

  return (
    <ScrollView
      contentContainerStyle={
        s.page
      }
    >
      <Header
        title="ACCOUNT"
        subtitle={
          user.email
        }
        profile={
          profile
        }
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
            borderRadius:
              34,
            borderWidth:
              2,
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
              fontSize:
                23,
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
                  marginTop:
                    5,
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

      <View
        style={s.panel}
      >
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
          setPage(
            "address"
          )
        }
      />

      <Link
        icon="📦"
        title="My orders"
        value={
          orders.length
        }
        onPress={() =>
          setPage(
            "orders"
          )
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

          <Link
            icon="💵"
            title="Seller payouts"
            value={
              sellerPayoutCount
            }
            onPress={() =>
              setPage(
                "sellerPayouts"
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
          setPage(
            "following"
          )
        }
      />

      <Link
        icon="★"
        title="Ratings"
        value={
          rating
            ? rating.toFixed(
                1
              )
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
            title="Seller payout requests"
            value={
              pendingAdminPayouts
            }
            onPress={() =>
              setPage(
                "adminPayouts"
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

function SellerPayoutOrder({
  order,
  requests,
  refresh,
  flash,
}) {
  const [
    busy,
    setBusy,
  ] = useState(false);

  const payoutStatus =
    String(
      order.payout_status ||
        "not_requested"
    ).toLowerCase();

  const existingRequest =
    requests.find(
      (request) =>
        request.order_id ===
        order.id
    );

  const requestPayout =
    () => {
      Alert.alert(
        "Request payout?",
        `Request ${money(
          order.seller_payout_amount ||
            0
        )} for this order?`,
        [
          {
            text:
              "Cancel",
            style:
              "cancel",
          },

          {
            text:
              "Request payout",

            onPress:
              async () => {
                setBusy(true);

                try {
                  await invokeMarketplace(
                    {
                      action:
                        "request_payout",

                      orderId:
                        order.id,
                    }
                  );

                  flash?.(
                    "Payout requested"
                  );

                  Alert.alert(
                    "Payout requested",
                    "Your request was sent to the administrator."
                  );

                  await refresh();
                } catch (
                  error
                ) {
                  Alert.alert(
                    "Payout request failed",
                    error.message
                  );
                } finally {
                  setBusy(false);
                }
              },
          },
        ]
      );
    };

  return (
    <View
      style={s.panel}
    >
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
            order.seller_payout_amount ||
              0
          )}
        </Text>
      </View>

      <Stat
        label="Order status"
        value={
          order.status
        }
      />

      <Stat
        label="Seller receives"
        value={money(
          order.seller_payout_amount ||
            0
        )}
      />

      <Stat
        label="Payout status"
        value={
          existingRequest
            ?.status ||
          payoutStatus
        }
      />

      {[
        "not_requested",
        "",
        "rejected",
      ].includes(
        payoutStatus
      ) && (
        <Button
          disabled={busy}
          title={
            busy
              ? "Requesting..."
              : `Request payout ${money(
                  order.seller_payout_amount ||
                    0
                )}`
          }
          onPress={
            requestPayout
          }
        />
      )}

      {payoutStatus ===
        "requested" && (
        <Text
          style={[
            s.muted,
            {
              marginTop:
                12,
            },
          ]}
        >
          Waiting for administrator approval.
        </Text>
      )}

      {payoutStatus ===
        "paid" && (
        <Text
          style={{
            color:
              C.green,
            fontWeight:
              "900",
            marginTop:
              12,
          }}
        >
          ✓ PAYOUT PAID
        </Text>
      )}
    </View>
  );
}

function SellerShippingOrder({
  order,
  refresh,
}) {
  const status =
    String(
      order.status ||
        ""
    ).toLowerCase();

  const markPacked =
    async () => {
      const {
        error,
      } =
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
          await invokeMarketplace(
            {
              action:
                "buy_label",

              orderId:
                order.id,
            }
          );

        await refresh();

        if (
          data?.labelUrl
        ) {
          await Linking.openURL(
            data.labelUrl
          );
        }
      } catch (
        error
      ) {
        Alert.alert(
          "Label failed",
          error.message
        );
      }
    };

  return (
    <View
      style={s.panel}
    >
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

      <Text
        style={s.muted}
      >
        Status:{" "}
        {status}
      </Text>

      <Text
        style={s.muted}
      >
        Seller receives:{" "}
        {money(
          order.seller_payout_amount ||
            0
        )}
      </Text>

      <Text
        style={s.muted}
      >
        E&T fee:{" "}
        {money(
          order.platform_fee ||
            0
        )}
      </Text>

      {status ===
        "paid" && (
        <Button
          title="Mark packed"
          onPress={
            markPacked
          }
        />
      )}

      {status ===
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

function BuyerOrder({
  order,
  refresh,
}) {
  const checkout =
    async () => {
      try {
        const data =
          await invokeMarketplace(
            {
              action:
                "create_checkout",

              orderId:
                order.id,
            }
          );

        if (
          data?.alreadyPaid
        ) {
          await refresh();

          return;
        }

        if (
          data?.url
        ) {
          await Linking.openURL(
            data.url
          );
        }
      } catch (
        error
      ) {
        Alert.alert(
          "Checkout failed",
          error.message
        );
      }
    };

  const verify =
    async () => {
      try {
        await invokeMarketplace(
          {
            action:
              "verify_checkout",

            orderId:
              order.id,
          }
        );

        await refresh();

        Alert.alert(
          "Payment received",
          "Payment was confirmed."
        );
      } catch (
        error
      ) {
        Alert.alert(
          "Could not verify payment",
          error.message
        );
      }
    };

  return (
    <View
      style={s.panel}
    >
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

      <Text
        style={s.muted}
      >
        Status:{" "}
        {String(
          order.status ||
            ""
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
              verify
            }
          />
        </>
      )}

      {order
        .tracking_number && (
        <Text
          style={s.muted}
        >
          Tracking:{" "}
          {
            order.tracking_number
          }
        </Text>
      )}
    </View>
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
  const status =
    String(
      payout.status ||
        ""
    ).toLowerCase();

  const orderStatus =
    String(
      order?.status ||
        ""
    ).toLowerCase();

  const eligible =
    order
      ?.payout_eligible_at
      ? new Date(
          order.payout_eligible_at
        )
      : null;

  const eligibleNow =
    eligible &&
    eligible.getTime() <=
      Date.now();

  const delivered =
    [
      "delivered",
      "completed",
    ].includes(
      orderStatus
    );

  return (
    <View
      style={s.panel}
    >
      <Text
        style={s.title}
      >
        {order?.products
          ?.title ||
          "Seller payout"}
      </Text>

      <Stat
        label="Seller receives"
        value={money(
          payout.amount ||
            0
        )}
      />

      <Stat
        label="Payout status"
        value={status}
      />

      <Stat
        label="Order status"
        value={
          orderStatus ||
          "unknown"
        }
      />

      {[
        "pending",
        "approved",
      ].includes(
        status
      ) &&
        !delivered && (
          <Button
            disabled={busy}
            title="Confirm delivery"
            onPress={() =>
              onDelivered(
                payout
              )
            }
          />
        )}

      {delivered &&
        eligibleNow &&
        [
          "pending",
          "approved",
        ].includes(
          status
        ) && (
          <Button
            disabled={busy}
            title={`Pay seller ${money(
              payout.amount
            )}`}
            onPress={() =>
              onPay(
                payout
              )
            }
          />
        )}

      {delivered &&
        eligible &&
        !eligibleNow && (
          <Text
            style={s.muted}
          >
            Eligible{" "}
            {eligible.toLocaleString()}
          </Text>
        )}

      {[
        "pending",
        "approved",
      ].includes(
        status
      ) && (
        <Button
          danger
          ghost
          title="Reject payout"
          onPress={() =>
            onReject(
              payout
            )
          }
        />
      )}

      {status ===
        "paid" && (
        <Text
          style={{
            color:
              C.green,
            fontWeight:
              "900",
          }}
        >
          ✓ PAID
        </Text>
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
          minHeight:
            60,
        },
      ]}
    >
      <Text
        style={{
          fontSize:
            21,
          width: 40,
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
        style={s.modalHeader}
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
