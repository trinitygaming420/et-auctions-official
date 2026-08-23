import React, {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Alert,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  money,
  supabase,
} from "./config";

import {
  Button,
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
  const [requestingId, setRequestingId] =
    useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
