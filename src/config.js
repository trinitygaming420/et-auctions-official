import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const LIVEKIT_URL = "wss://project-e-t-auctions-v8gsnc5i.livekit.cloud";
export const supabase = createClient(
  "https://jvyiisvxvjiykqagffpq.supabase.co",
  "sb_publishable_w-37jRWUXPYTEGLlrT89uw_Eh7EIu9K",
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export const colors = {
  bg: "#080A0F",
  card: "#121722",
  card2: "#191F2B",
  orange: "#FF5B2A",
  text: "#F7F8FA",
  muted: "#98A2B3",
  green: "#21C17A",
  red: "#F04438",
  line: "#252C39",
};

export const money = (value) => `$${Number(value || 0).toFixed(2)}`;
