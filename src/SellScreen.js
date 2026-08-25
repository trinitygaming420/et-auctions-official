import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";

import * as ImagePicker from "expo-image-picker";

import {
  colors as C,
  money,
  supabase,
} from "./config";

import {
  Button,
  Field,
  Header,
  Stat,
  s,
} from "./ui";

import LiveVideo from "./LiveVideo";

const blank = {
  title: "",
  description: "",
  quantity: "1",
  bid: "",
  weight: "8",
  length: "8",
  width: "6",
  height: "4",
};

function productPayload(
  values,
  user,
  showId,
  temporary = false
) {
  return {
    seller_id: user.id,
    show_id: showId,

    title: values.title.trim(),
    description:
      values.description.trim(),

    stock: Number(
      values.quantity
    ),

    starting_bid: Number(
      values.bid
    ),

    price: Number(
      values.bid
    ),

    weight_oz: Number(
      values.weight
    ),

    length_in: Number(
      values.length
    ),

    width_in: Number(
      values.width
    ),

    height_in: Number(
      values.height
    ),

    status: "active",

    is_temporary:
      temporary,
  };
}

function validateProduct(
  values
) {
  if (!values.title.trim()) {
    return "Enter a product title.";
  }

  if (
    !Number.isFinite(
      Number(values.bid)
    ) ||
    Number(values.bid) <= 0
  ) {
    return "Enter a valid starting price.";
  }

  if (
    !Number.isInteger(
      Number(values.quantity)
    ) ||
    Number(values.quantity) < 1
  ) {
    return "Quantity must be at least 1.";
  }

  if (
    !Number.isFinite(
      Number(values.weight)
    ) ||
    Number(values.weight) <= 0
  ) {
    return "Enter a valid shipping weight.";
  }

  for (const field of [
    "length",
    "width",
    "height",
  ]) {
    if (
      !Number.isFinite(
        Number(values[field])
      ) ||
      Number(values[field]) <=
        0
    ) {
      return `Enter a valid ${field}.`;
    }
  }

  return null;
}

async function invokeFunction(
  name,
  body
) {
  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      name,
      {
        body,
      }
    );

  if (error) {
    let message =
      error.message ||
      `${name} failed`;

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

export default function SellScreen({
  profile,
  user,
  flash,
}) {
  const [
    shows,
    setShows,
  ] = useState([]);

  const [
    activeShow,
    setActiveShow,
  ] = useState(null);

  const [
    schedule,
    setSchedule,
  ] = useState(false);

  const [
    manage,
    setManage,
  ] = useState(null);

  const [
    host,
    setHost,
  ] = useState(null);

  const [
    stats,
    setStats,
  ] = useState({
    listings: 0,
    live: 0,
    ship: 0,
  });

  const load =
    useCallback(
      async () => {
        const [
          scheduledResult,
          liveResult,
          listingsResult,
          liveCountResult,
          shipResult,
        ] =
          await Promise.all([
            supabase
              .from("shows")
              .select("*")
              .eq(
                "seller_id",
                user.id
              )
              .eq(
                "status",
                "scheduled"
              )
              .order(
                "starts_at"
              ),

            supabase
              .from("shows")
              .select("*")
              .eq(
                "seller_id",
                user.id
              )
              .eq(
                "status",
                "live"
              )
              .order(
                "created_at",
                {
                  ascending:
                    false,
                }
              )
              .limit(1),

            supabase
              .from("products")
              .select("id", {
                head: true,
                count: "exact",
              })
              .eq(
                "seller_id",
                user.id
              ),

            supabase
              .from("shows")
              .select("id", {
                head: true,
                count: "exact",
              })
              .eq(
                "seller_id",
                user.id
              )
              .eq(
                "status",
                "live"
              ),

            supabase
              .from("orders")
              .select("id", {
                head: true,
                count: "exact",
              })
              .eq(
                "seller_id",
                user.id
              )
              .in(
                "status",
                [
                  "paid",
                  "packed",
                ]
              ),
          ]);

        if (
          scheduledResult.error
        ) {
          console.log(
            "SHOW_LOAD_ERROR:",
            scheduledResult
              .error.message
          );
        }

        if (
          liveResult.error
        ) {
          console.log(
            "LIVE_SHOW_LOAD_ERROR:",
            liveResult.error
              .message
          );
        }

        setShows(
          scheduledResult.data ||
            []
        );

        setActiveShow(
          liveResult.data?.[0] ||
            null
        );

        setStats({
          listings:
            listingsResult.count ||
            0,

          live:
            liveCountResult.count ||
            0,

          ship:
            shipResult.count ||
            0,
        });
      },
      [user.id]
    );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel =
      supabase
        .channel(
          `seller-hub-${user.id}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "shows",
            filter:
              `seller_id=eq.${user.id}`,
          },
          () => load()
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter:
              `seller_id=eq.${user.id}`,
          },
          () => load()
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [load, user.id]);

  const approved =
    (fn) => {
      if (
        profile?.seller_approved
      ) {
        fn();
        return;
      }

      Alert.alert(
        "Approval required",
        "Your seller account must be approved first."
      );
    };

  const go =
    async (show) => {
      try {
        const {
          data:
            existingRows,
          error:
            existingError,
        } =
          await supabase
            .from("shows")
            .select("*")
            .eq(
              "seller_id",
              user.id
            )
            .eq(
              "status",
              "live"
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              }
            )
            .limit(1);

        if (existingError) {
          throw existingError;
        }

        const existing =
          existingRows?.[0] ||
          null;

        if (
          existing &&
          existing.id !==
            show.id
        ) {
          setManage(null);
          setHost(existing);

          Alert.alert(
            "Live show already running",
            "You already have a live show. The app will resume that show instead of starting another one."
          );

          return;
        }

        if (
          existing &&
          existing.id ===
            show.id
        ) {
          setManage(null);
          setHost(existing);
          return;
        }

        const {
          data,
          error,
        } =
          await supabase
            .from("shows")
            .update({
              status: "live",
              current_product_id:
                null,
              auction_ends_at:
                null,
              ended_at: null,
            })
            .eq(
              "id",
              show.id
            )
            .eq(
              "seller_id",
              user.id
            )
            .select()
            .single();

        if (error) {
          throw error;
        }

        setManage(null);
        setHost(data);

        await load();
      } catch (error) {
        Alert.alert(
          "Show error",
          error.message
        );
      }
    };

  return (
    <ScrollView
      contentContainerStyle={
        s.page
      }
    >
      <Header
        title="SELLER HUB"
        subtitle="Schedule shows and load auction inventory"
        profile={profile}
      />

      <Button
        title="Schedule a Show"
        onPress={() =>
          approved(() =>
            setSchedule(true)
          )
        }
      />

      {activeShow && (
        <View
          style={s.panel}
        >
          <Text
            style={
              s.section
            }
          >
            Live now
          </Text>

          <Text
            style={s.title}
          >
            {activeShow.title}
          </Text>

          <Text
            style={[
              s.badge,
              {
                marginTop: 5,
              },
            ]}
          >
            ● LIVE
          </Text>

          <Text
            style={[
              s.muted,
              {
                marginTop: 8,
              },
            ]}
          >
            If the app was
            closed or
            disconnected, resume
            this show instead of
            creating a second
            live room.
          </Text>

          <Button
            title="Resume live"
            onPress={() =>
              setHost(
                activeShow
              )
            }
          />
        </View>
      )}

      <View
        style={s.panel}
      >
        <Text
          style={s.section}
        >
          Upcoming shows
        </Text>

        {shows.length ? (
          shows.map(
            (show) => (
              <View
                key={
                  show.id
                }
                style={
                  s.activity
                }
              >
                <View
                  style={{
                    flex: 1,
                  }}
                >
                  <Text
                    style={
                      s.title
                    }
                  >
                    {
                      show.title
                    }
                  </Text>

                  <Text
                    style={
                      s.muted
                    }
                  >
                    {new Date(
                      show.starts_at
                    ).toLocaleString()}{" "}
                    ·{" "}
                    {
                      show.category
                    }
                  </Text>

                  <Text
                    style={
                      s.badge
                    }
                  >
                    {(
                      show.tags ||
                      []
                    )
                      .map(
                        (
                          tag
                        ) =>
                          `#${tag}`
                      )
                      .join(
                        " "
                      )}
                  </Text>
                </View>

                <Button
                  small
                  title="Open"
                  onPress={() =>
                    setManage(
                      show
                    )
                  }
                />
              </View>
            )
          )
        ) : (
          <Text
            style={s.muted}
          >
            No upcoming shows.
          </Text>
        )}
      </View>

      <View
        style={s.panel}
      >
        <Text
          style={s.section}
        >
          Today's tasks
        </Text>

        <Stat
          label="Loaded products"
          value={
            stats.listings
          }
        />

        <Stat
          label="Live shows"
          value={
            stats.live
          }
        />

        <Stat
          label="Orders to ship"
          value={
            stats.ship
          }
        />
      </View>

      {schedule && (
        <Scheduler
          user={user}
          flash={flash}
          close={() => {
            setSchedule(
              false
            );

            load();
          }}
          go={go}
        />
      )}

      {manage && (
        <Manager
          show={manage}
          user={user}
          flash={flash}
          close={() => {
            setManage(null);
            load();
          }}
          go={() =>
            go(manage)
          }
        />
      )}

      {host && (
        <Host
          show={host}
          user={user}
          flash={flash}
          end={() => {
            setHost(null);
            load();
          }}
        />
      )}
    </ScrollView>
  );
}

function Scheduler({
  user,
  flash,
  close,
  go,
}) {
  const [
    values,
    setValues,
  ] = useState({
    title: "",
    category:
      "Electronics",
    tags: "",
  });

  const [
    photo,
    setPhoto,
  ] = useState(null);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const set =
    (key, value) =>
      setValues(
        (current) => ({
          ...current,
          [key]: value,
        })
      );

  const pick =
    async () => {
      const permission =
        await ImagePicker
          .requestMediaLibraryPermissionsAsync();

      if (
        !permission.granted
      ) {
        Alert.alert(
          "Permission required",
          "Allow photo access for show thumbnails."
        );

        return;
      }

      const result =
        await ImagePicker
          .launchImageLibraryAsync(
            {
              mediaTypes:
                ImagePicker
                  .MediaTypeOptions
                  .Images,

              allowsEditing:
                true,

              aspect: [16, 9],

              quality: 0.8,
            }
          );

      if (
        !result.canceled
      ) {
        setPhoto(
          result.assets[0]
        );
      }
    };

  const save =
    async () => {
      if (
        !values.title.trim()
      ) {
        Alert.alert(
          "Missing details",
          "Enter a show title."
        );

        return;
      }

      setBusy(true);

      try {
        let coverUrl =
          null;

        if (photo) {
          const body =
            await (
              await fetch(
                photo.uri
              )
            ).arrayBuffer();

          const path =
            `${user.id}/shows/${Date.now()}.jpg`;

          const {
            error:
              uploadError,
          } =
            await supabase.storage
              .from(
                "show-media"
              )
              .upload(
                path,
                body,
                {
                  contentType:
                    photo.mimeType ||
                    "image/jpeg",
                }
              );

          if (
            uploadError
          ) {
            throw uploadError;
          }

          coverUrl =
            supabase.storage
              .from(
                "show-media"
              )
              .getPublicUrl(
                path
              ).data
              .publicUrl;
        }

        const {
          data,
          error,
        } =
          await supabase
            .from("shows")
            .insert({
              seller_id:
                user.id,

              title:
                values.title.trim(),

              category:
                values.category,

              tags:
                values.tags
                  .split(",")
                  .map(
                    (
                      tag
                    ) =>
                      tag.trim()
                  )
                  .filter(
                    Boolean
                  ),

              cover_url:
                coverUrl,

              starts_at:
                new Date().toISOString(),

              status:
                "scheduled",

              room_name:
                `show_${user.id.slice(
                  0,
                  8
                )}_${Date.now()}`,
            })
            .select()
            .single();

        if (error) {
          throw error;
        }

        flash?.(
          "Starting livestream"
        );

        close();

        await go(data);
      } catch (error) {
        Alert.alert(
          "Go-live error",
          error.message
        );
      } finally {
        setBusy(false);
      }
    };

  return (
    <Modal
      visible
      animationType="slide"
    >
      <SafeAreaView
        style={s.safe}
      >
        <ScrollView
          contentContainerStyle={
            s.page
          }
        >
          <Text
            style={s.logo}
          >
            Start a Show
          </Text>

          <Field
            label="Catchy title"
            value={
              values.title
            }
            onChangeText={(
              value
            ) =>
              set(
                "title",
                value
              )
            }
          />

          <Field
            label="Category"
            value={
              values.category
            }
            onChangeText={(
              value
            ) =>
              set(
                "category",
                value
              )
            }
          />

          <Field
            label="Search tags, separated by commas"
            value={
              values.tags
            }
            onChangeText={(
              value
            ) =>
              set(
                "tags",
                value
              )
            }
          />

          <Pressable
            onPress={
              pick
            }
            style={
              s.panel
            }
          >
            {photo ? (
              <Image
                source={{
                  uri:
                    photo.uri,
                }}
                style={{
                  width:
                    "100%",
                  height: 180,
                  borderRadius:
                    12,
                }}
              />
            ) : (
              <>
                <Text
                  style={
                    s.title
                  }
                >
                  ＋ Add show
                  thumbnail
                </Text>

                <Text
                  style={
                    s.muted
                  }
                >
                  Choose an
                  eye-catching
                  16:9 photo.
                </Text>
              </>
            )}
          </Pressable>

          <Button
            disabled={
              busy
            }
            title={
              busy
                ? "Starting..."
                : "Go live now"
            }
            onPress={
              save
            }
          />

          <Button
            ghost
            title="Cancel"
            onPress={
              close
            }
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ItemForm({
  save,
  busy,
  temp = false,
}) {
  const [
    values,
    setValues,
  ] =
    useState(blank);

  const set =
    (key, value) =>
      setValues(
        (current) => ({
          ...current,
          [key]: value,
        })
      );

  const submit =
    () => {
      const validationError =
        validateProduct(
          values
        );

      if (
        validationError
      ) {
        Alert.alert(
          "Product information",
          validationError
        );

        return;
      }

      save(values);
    };

  return (
    <View
      style={s.panel}
    >
      <Text
        style={s.section}
      >
        {temp
          ? "Temporary live listing"
          : "Add product"}
      </Text>

      <Field
        label="Title"
        value={
          values.title
        }
        onChangeText={(
          value
        ) =>
          set(
            "title",
            value
          )
        }
      />

      <Field
        label="Description"
        value={
          values.description
        }
        onChangeText={(
          value
        ) =>
          set(
            "description",
            value
          )
        }
      />

      <View
        style={s.row}
      >
        <View
          style={{
            flex: 1,
          }}
        >
          <Field
            label="Quantity"
            value={
              values.quantity
            }
            onChangeText={(
              value
            ) =>
              set(
                "quantity",
                value
              )
            }
            keyboardType="number-pad"
          />
        </View>

        <View
          style={{
            flex: 1,
          }}
        >
          <Field
            label="Starting price"
            value={
              values.bid
            }
            onChangeText={(
              value
            ) =>
              set(
                "bid",
                value
              )
            }
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Field
        label="Shipping weight (oz)"
        value={
          values.weight
        }
        onChangeText={(
          value
        ) =>
          set(
            "weight",
            value
          )
        }
        keyboardType="decimal-pad"
      />

      <View
        style={s.row}
      >
        {[
          "length",
          "width",
          "height",
        ].map(
          (key) => (
            <View
              key={
                key
              }
              style={{
                flex: 1,
              }}
            >
              <Field
                label={
                  key
                }
                value={
                  values[
                    key
                  ]
                }
                onChangeText={(
                  value
                ) =>
                  set(
                    key,
                    value
                  )
                }
                keyboardType="decimal-pad"
              />
            </View>
          )
        )}
      </View>

      <Button
        disabled={
          busy
        }
        title={
          temp
            ? "Create and run"
            : "Add to show"
        }
        onPress={
          submit
        }
      />
    </View>
  );
}

function Manager({
  show,
  user,
  flash,
  close,
  go,
}) {
  const [
    items,
    setItems,
  ] = useState([]);

  const [
    form,
    setForm,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const load =
    useCallback(
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "products"
            )
            .select("*")
            .eq(
              "show_id",
              show.id
            );

        if (error) {
          console.log(
            "PRODUCT_LOAD_ERROR:",
            error.message
          );

          return;
        }

        setItems(
          data || []
        );
      },
      [show.id]
    );

  useEffect(() => {
    load();
  }, [load]);

  const save =
    async (
      values
    ) => {
      const validationError =
        validateProduct(
          values
        );

      if (
        validationError
      ) {
        Alert.alert(
          "Product error",
          validationError
        );

        return;
      }

      setBusy(true);

      try {
        const {
          error,
        } =
          await supabase
            .from(
              "products"
            )
            .insert(
              productPayload(
                values,
                user,
                show.id
              )
            );

        if (error) {
          throw error;
        }

        flash?.(
          "Product loaded"
        );

        setForm(false);

        await load();
      } catch (error) {
        Alert.alert(
          "Product error",
          error.message
        );
      } finally {
        setBusy(false);
      }
    };

  return (
    <Modal
      visible
      animationType="slide"
    >
      <SafeAreaView
        style={s.safe}
      >
        <ScrollView
          contentContainerStyle={
            s.page
          }
        >
          <Text
            style={s.logo}
          >
            {show.title}
          </Text>

          <Text
            style={s.muted}
          >
            {new Date(
              show.starts_at
            ).toLocaleString()}
          </Text>

          <View
            style={s.panel}
          >
            <Text
              style={
                s.section
              }
            >
              Preloaded products
            </Text>

            {items.map(
              (item) => (
                <View
                  key={
                    item.id
                  }
                  style={
                    s.stat
                  }
                >
                  <Text
                    style={
                      s.title
                    }
                  >
                    {
                      item.title
                    }
                  </Text>

                  <Text
                    style={
                      s.price
                    }
                  >
                    {money(
                      item.starting_bid
                    )}
                  </Text>
                </View>
              )
            )}

            <Button
              ghost
              title={
                form
                  ? "Close"
                  : "＋ Add product"
              }
              onPress={() =>
                setForm(
                  (current) =>
                    !current
                )
              }
            />
          </View>

          {form && (
            <ItemForm
              busy={
                busy
              }
              save={
                save
              }
            />
          )}

          <Button
            title="Go live now"
            onPress={
              go
            }
          />

          <Button
            ghost
            title="Back"
            onPress={
              close
            }
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Host({
  show,
  user,
  flash,
  end,
}) {
  const [
    items,
    setItems,
  ] = useState([]);

  const [
    product,
    setProduct,
  ] = useState(null);

  const [
    menu,
    setMenu,
  ] = useState(false);

  const [
    form,
    setForm,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    ends,
    setEnds,
  ] = useState(null);

  const [
    left,
    setLeft,
  ] = useState(0);

  const [
    duration,
    setDuration,
  ] = useState("15");

  const [
    camera,
    setCamera,
  ] = useState(null);

  const [
    currentBid,
    setCurrentBid,
  ] = useState(0);

  const [
    bidCount,
    setBidCount,
  ] = useState(0);

  const finishingRef =
    useRef(false);

  const load =
    useCallback(
      async () => {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "products"
            )
            .select("*")
            .eq(
              "show_id",
              show.id
            )
            .eq(
              "status",
              "active"
            )
            .order(
              "created_at",
              {
                ascending:
                  true,
              }
            );

        if (error) {
          console.log(
            "HOST_PRODUCT_LOAD_ERROR:",
            error.message
          );

          return;
        }

        setItems(
          data || []
        );
      },
      [show.id]
    );

  const loadBids =
    useCallback(
      async (
        productId,
        fallbackAmount = 0
      ) => {
        if (!productId) {
          setBidCount(0);
          setCurrentBid(0);
          return;
        }

        const {
          data,
          error,
        } =
          await supabase
            .from("bids")
            .select(
              "id,amount,bidder_id"
            )
            .eq(
              "show_id",
              show.id
            )
            .eq(
              "product_id",
              productId
            )
            .order(
              "amount",
              {
                ascending:
                  false,
              }
            );

        if (error) {
          console.log(
            "HOST_BID_LOAD_ERROR:",
            error.message
          );

          return;
        }

        const rows =
          data || [];

        setBidCount(
          rows.length
        );

        setCurrentBid(
          Number(
            rows[0]
              ?.amount ??
              fallbackAmount ??
              0
          )
        );
      },
      [show.id]
    );

  const syncShow =
    useCallback(
      async () => {
        const {
          data:
            currentShow,
          error:
            showError,
        } =
          await supabase
            .from("shows")
            .select(
              "id,status,current_product_id,auction_ends_at"
            )
            .eq(
              "id",
              show.id
            )
            .maybeSingle();

        if (showError) {
          console.log(
            "HOST_SHOW_SYNC_ERROR:",
            showError.message
          );

          return;
        }

        if (
          !currentShow ||
          currentShow.status !==
            "live"
        ) {
          end();
          return;
        }

        if (
          !currentShow.current_product_id
        ) {
          setProduct(null);
          setEnds(null);
          setLeft(0);
          setBidCount(0);
          setCurrentBid(0);

          await load();

          return;
        }

        const {
          data:
            currentProduct,
          error:
            productError,
        } =
          await supabase
            .from(
              "products"
            )
            .select("*")
            .eq(
              "id",
              currentShow.current_product_id
            )
            .maybeSingle();

        if (
          productError
        ) {
          console.log(
            "HOST_CURRENT_PRODUCT_ERROR:",
            productError.message
          );

          return;
        }

        if (
          !currentProduct
        ) {
          return;
        }

        setProduct(
          currentProduct
        );

        setEnds(
          currentShow.auction_ends_at ||
            null
        );

        await loadBids(
          currentProduct.id,
          currentProduct.starting_bid ??
            currentProduct.price ??
            0
        );
      },
      [
        end,
        load,
        loadBids,
        show.id,
      ]
    );

  useEffect(() => {
    load();
    syncShow();
  }, [
    load,
    syncShow,
  ]);

  useEffect(() => {
    const channel =
      supabase
        .channel(
          `host-live-${show.id}`
        )
        .on(
          "postgres_changes",
          {
            event:
              "UPDATE",
            schema:
              "public",
            table:
              "shows",
            filter:
              `id=eq.${show.id}`,
          },
          () =>
            syncShow()
        )
        .on(
          "postgres_changes",
          {
            event:
              "INSERT",
            schema:
              "public",
            table:
              "bids",
            filter:
              `show_id=eq.${show.id}`,
          },
          () =>
            syncShow()
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [
    show.id,
    syncShow,
  ]);

  const run =
    async (item) => {
      if (busy) return;

      if (product) {
        Alert.alert(
          "Auction running",
          "Wait for the current auction to finish before starting another product."
        );

        return;
      }

      const seconds =
        Math.floor(
          Number(duration)
        );

      if (
        !Number.isFinite(
          seconds
        ) ||
        seconds < 3 ||
        seconds > 3600
      ) {
        Alert.alert(
          "Invalid timer",
          "Enter an auction timer between 3 and 3600 seconds."
        );

        return;
      }

      setBusy(true);

      try {
        const endTime =
          new Date(
            Date.now() +
              seconds *
                1000
          ).toISOString();

        const {
          data:
            updatedShow,
          error,
        } =
          await supabase
            .from("shows")
            .update({
              current_product_id:
                item.id,

              auction_ends_at:
                endTime,
            })
            .eq(
              "id",
              show.id
            )
            .eq(
              "seller_id",
              user.id
            )
            .eq(
              "status",
              "live"
            )
            .select(
              "id,current_product_id,auction_ends_at"
            )
            .maybeSingle();

        if (error) {
          throw error;
        }

        if (
          !updatedShow
        ) {
          throw new Error(
            "The live show is no longer active."
          );
        }

        setProduct(
          item
        );

        setEnds(
          updatedShow.auction_ends_at
        );

        setLeft(
          seconds
        );

        setCurrentBid(
          Number(
            item.starting_bid ??
              item.price ??
              0
          )
        );

        setBidCount(0);

        setMenu(false);
        setForm(false);

        flash?.(
          `${item.title} auction started`
        );
      } catch (error) {
        Alert.alert(
          "Auction error",
          error.message
        );
      } finally {
        setBusy(false);
      }
    };

  const finish =
    useCallback(
      async () => {
        if (
          !product ||
          finishingRef.current
        ) {
          return;
        }

        finishingRef.current =
          true;

        setBusy(true);

        try {
          const {
            data,
            error,
          } =
            await supabase.rpc(
              "finish_live_product_auction",
              {
                target_show:
                  show.id,

                target_product:
                  product.id,
              }
            );

          if (error) {
            const message =
              String(
                error.message ||
                  ""
              );

            if (
              message
                .toLowerCase()
                .includes(
                  "still running"
                )
            ) {
              await syncShow();
              return;
            }

            throw error;
          }

          setProduct(null);
          setEnds(null);
          setLeft(0);
          setBidCount(0);
          setCurrentBid(0);

          await load();

          await syncShow();

          if (
            data?.winner
          ) {
            flash?.(
              `Sold for ${money(
                data?.amount ||
                  0
              )}`
            );
          } else {
            flash?.(
              "Auction ended with no bids"
            );
          }
        } catch (error) {
          Alert.alert(
            "Auction error",
            error.message
          );
        } finally {
          finishingRef.current =
            false;

          setBusy(false);
        }
      },
      [
        flash,
        load,
        product,
        show.id,
        syncShow,
      ]
    );

  useEffect(() => {
    if (
      !ends ||
      !product
    ) {
      setLeft(0);
      return;
    }

    const tick =
      () => {
        const endMs =
          Date.parse(
            ends
          );

        if (
          Number.isNaN(
            endMs
          )
        ) {
          setLeft(0);
          return;
        }

        const seconds =
          Math.max(
            0,
            Math.ceil(
              (endMs -
                Date.now()) /
                1000
            )
          );

        setLeft(
          seconds
        );

        if (
          seconds <= 0
        ) {
          finish();
        }
      };

    tick();

    const timer =
      setInterval(
        tick,
        250
      );

    return () =>
      clearInterval(
        timer
      );
  }, [
    ends,
    finish,
    product,
  ]);

  const temp =
    async (
      values
    ) => {
      const validationError =
        validateProduct(
          values
        );

      if (
        validationError
      ) {
        Alert.alert(
          "Product error",
          validationError
        );

        return;
      }

      if (product) {
        Alert.alert(
          "Auction running",
          "Finish the current product before adding and running another one."
        );

        return;
      }

      setBusy(true);

      try {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "products"
            )
            .insert(
              productPayload(
                values,
                user,
                show.id,
                true
              )
            )
            .select()
            .single();

        if (error) {
          throw error;
        }

        await load();

        setForm(false);

        await run(data);
      } catch (error) {
        Alert.alert(
          "Product error",
          error.message
        );
      } finally {
        setBusy(false);
      }
    };

  const endLive =
    async () => {
      if (product) {
        Alert.alert(
          "Auction running",
          "Wait for the current product auction to finish before ending the live."
        );

        return;
      }

      if (busy) return;

      setBusy(true);

      try {
        const data =
          await invokeFunction(
            "end-live",
            {
              showId:
                show.id,
            }
          );

        const cancelled =
          Number(
            data
              ?.cancelledUnpaidOrders ||
              0
          );

        const paidFound =
          Number(
            data
              ?.paymentsFound ||
              0
          );

        if (
          cancelled > 0
        ) {
          flash?.(
            `Live ended · ${cancelled} unpaid sale${
              cancelled ===
              1
                ? ""
                : "s"
            } cancelled`
          );
        } else if (
          paidFound > 0
        ) {
          flash?.(
            `Live ended · ${paidFound} paid sale${
              paidFound ===
              1
                ? ""
                : "s"
            } saved`
          );
        } else {
          flash?.(
            "Live ended"
          );
        }

        end();
      } catch (error) {
        Alert.alert(
          "End live failed",
          error.message
        );
      } finally {
        setBusy(false);
      }
    };

  return (
    <Modal visible>
      <SafeAreaView
        style={s.safe}
      >
        <View
          style={
            s.modalHeader
          }
        >
          <Text
            style={s.logo}
          >
            YOU ARE LIVE ·{" "}
            {show.title}
          </Text>
        </View>

        <LiveVideo
          room={
            show.room_name
          }
          user={user}
          host
          onCameraController={
            setCamera
          }
        />

        <ScrollView
          contentContainerStyle={[
            s.page,
            {
              paddingBottom:
                120,
            },
          ]}
        >
          {product ? (
            <View
              style={s.panel}
            >
              <Text
                style={
                  s.logo
                }
              >
                {
                  product.title
                }
              </Text>

              <Stat
                label="Time left"
                value={`${left}s`}
              />

              <Stat
                label="Current bid"
                value={money(
                  currentBid
                )}
              />

              <Stat
                label="Bids"
                value={
                  bidCount
                }
              />

              <Text
                style={
                  s.muted
                }
              >
                Ends
                automatically.
                Every accepted
                bid adds 3
                seconds.
              </Text>

              {busy && (
                <Text
                  style={[
                    s.muted,
                    {
                      marginTop:
                        8,
                    },
                  ]}
                >
                  Finalizing
                  auction...
                </Text>
              )}
            </View>
          ) : (
            <View
              style={s.panel}
            >
              <Text
                style={
                  s.section
                }
              >
                No product
                running
              </Text>

              <Text
                style={
                  s.muted
                }
              >
                Open Products
                below to start
                the next auction.
              </Text>
            </View>
          )}

          {menu &&
            !product && (
              <View
                style={
                  s.panel
                }
              >
                <Text
                  style={
                    s.section
                  }
                >
                  Product menu
                </Text>

                <Field
                  label="Timer seconds"
                  value={
                    duration
                  }
                  onChangeText={
                    setDuration
                  }
                  keyboardType="number-pad"
                />

                {items.length ? (
                  items.map(
                    (
                      item
                    ) => (
                      <View
                        key={
                          item.id
                        }
                        style={
                          s.activity
                        }
                      >
                        <View
                          style={{
                            flex: 1,
                          }}
                        >
                          <Text
                            style={
                              s.title
                            }
                          >
                            {
                              item.title
                            }
                          </Text>

                          <Text
                            style={
                              s.muted
                            }
                          >
                            Starting{" "}
                            {money(
                              item.starting_bid
                            )}
                          </Text>
                        </View>

                        <Button
                          small
                          disabled={
                            busy
                          }
                          title="Run"
                          onPress={() =>
                            run(
                              item
                            )
                          }
                        />
                      </View>
                    )
                  )
                ) : (
                  <Text
                    style={
                      s.muted
                    }
                  >
                    No active
                    products are
                    loaded for
                    this show.
                  </Text>
                )}

                <Button
                  ghost
                  title={
                    form
                      ? "Close listing"
                      : "＋ Temporary listing"
                  }
                  onPress={() =>
                    setForm(
                      (
                        current
                      ) =>
                        !current
                    )
                  }
                />
              </View>
            )}

          {menu &&
            form &&
            !product && (
              <ItemForm
                temp
                busy={
                  busy
                }
                save={
                  temp
                }
              />
            )}
        </ScrollView>

        <View
          style={s.nav}
        >
          <View
            style={{
              flex: 1,
            }}
          >
            <Button
              ghost
              title="⟳ Camera"
              onPress={() =>
                camera?.()
              }
            />
          </View>

          <View
            style={{
              flex: 1,
            }}
          >
            <Button
              ghost
              title="▣ Products"
              onPress={() =>
                setMenu(
                  (
                    current
                  ) =>
                    !current
                )
              }
            />
          </View>

          <View
            style={{
              flex: 1,
            }}
          >
            <Button
              danger
              disabled={
                busy
              }
              title={
                busy
                  ? "Working..."
                  : "End live"
              }
              onPress={
                endLive
              }
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
