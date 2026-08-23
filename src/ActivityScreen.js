import React, {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  money,
  supabase,
} from "./config";

import {
  Empty,
  Header,
  s,
} from "./ui";

export default function ActivityScreen({
  profile,
  user,
  flash,
}) {
  const [orders, setOrders] = useState([]);
  const [requestingId, setRequestingId] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select(`
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
        created_at,
        products(title)
      `)
      .or(
        `buyer_id.eq.${user.id},seller_id.eq.${user.id}`
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(30);

    if (error) {
      console.log(
        "Could not load activity:",
        error.message
      );
      return;
    }

    setOrders(data || []);
  }, [user.id]);

  useEffect(() => {
    load();

    const ch = supabase
      .channel(`activity-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, user.id]);

  async function requestPayout(order) {
    if (requestingId) {
      return;
    }

    try {
      setRequestingId(order.id);

      const { data, error } =
        await supabase.functions.invoke(
          "marketplace-api",
          {
            body: {
              action: "request_payout",
              orderId: order.id,
            },
          }
        );

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      flash?.("Payout request submitted");

      Alert.alert(
        "Payout Requested",
        "Your payout request was sent to E&T Auctions for review."
      );

      await load();
    } catch (error) {
      Alert.alert(
        "Payout Request",
        error?.message ||
          "Unable to request payout."
      );
    } finally {
      setRequestingId(null);
    }
  }

  function payoutButton(order) {
    const isSeller =
      order.seller_id === user.id;

    if (!isSeller) {
      return null;
    }

    const status = String(
      order.status || ""
    ).toLowerCase();

    const payoutStatus = String(
      order.payout_status || "not_requested"
    ).toLowerCase();

    if (payoutStatus === "paid") {
      return (
        <Text
          style={{
            color: "#61D68A",
            fontWeight: "900",
            marginTop: 8,
          }}
        >
          ✓ Seller payout paid
        </Text>
      );
    }

    if (payoutStatus === "requested") {
      return (
        <Text
          style={{
            color: "#FFB347",
            fontWeight: "900",
            marginTop: 8,
          }}
        >
          Payout request pending
        </Text>
      );
    }

    if (payoutStatus === "rejected") {
      return (
        <Pressable
          onPress={() =>
            requestPayout(order)
          }
          style={s.mainButton}
        >
          <Text style={s.buttonText}>
            Request Payout Again
          </Text>
        </Pressable>
      );
    }

    const delivered =
      status === "delivered" ||
      status === "completed";

    if (!delivered) {
      return (
        <Text
          style={[
            s.muted,
            {
              marginTop: 8,
            },
          ]}
        >
          Payout available after delivery
        </Text>
      );
    }

    return (
      <Pressable
        disabled={
          requestingId === order.id
        }
        onPress={() =>
          requestPayout(order)
        }
        style={s.mainButton}
      >
        <Text style={s.buttonText}>
          {requestingId === order.id
            ? "Requesting..."
            : "Request Payout"}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.page}
    >
      <Header
        title="ACTIVITY"
        subtitle="Orders and marketplace updates"
        profile={profile}
      />

      <Text style={s.section}>
        Recent activity
      </Text>

      {!orders.length && (
        <Empty
          icon="🔔"
          title="No activity yet"
          subtitle="Bids, orders and shipping updates appear here."
        />
      )}

      {orders.map((order) => {
        const isSeller =
          order.seller_id === user.id;

        const sellerAmount = Number(
          order.seller_payout_amount || 0
        );

        return (
          <View
            key={order.id}
            style={[
              s.activity,
              {
                alignItems: "flex-start",
              },
            ]}
          >
            <Text
              style={{
                fontSize: 25,
                marginTop: 2,
              }}
            >
              📦
            </Text>

            <View
              style={{
                flex: 1,
              }}
            >
              <Text style={s.title}>
                {order.products?.title ||
                  "Marketplace order"}
              </Text>

              <Text style={s.muted}>
                {order.status} · Payout{" "}
                {order.payout_status ||
                  "not requested"}
              </Text>

              {isSeller &&
                sellerAmount > 0 && (
                  <Text
                    style={[
                      s.muted,
                      {
                        marginTop: 5,
                      },
                    ]}
                  >
                    Seller payout:{" "}
                    {money(sellerAmount)}
                  </Text>
                )}

              {payoutButton(order)}
            </View>

            <Text style={s.price}>
              {money(order.total)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
