const endLive = async () => {
  if (product) {
    Alert.alert(
      "Auction running",
      "Wait for the current product auction to finish before ending the live."
    );
    return;
  }

  setBusy(true);

  try {
    const { data, error } = await supabase.rpc(
      "end_my_live_show",
      {
        target_show: show.id,
      }
    );

    if (error) {
      throw error;
    }

    const cancelled =
      Number(data?.cancelledUnpaidOrders || 0);

    if (cancelled > 0) {
      flash?.(
        `Live ended · ${cancelled} unpaid sale${
          cancelled === 1 ? "" : "s"
        } cancelled`
      );
    } else {
      flash?.("Live ended");
    }

    end();
  } catch (error) {
    Alert.alert(
      "End live failed",
      error?.message ||
        "Could not end the live show."
    );
  } finally {
    setBusy(false);
  }
};
