const endLive = async () => {
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
    const { data, error } =
      await supabase.functions.invoke(
        "end-live",
        {
          body: {
            showId: show.id,
          },
        }
      );

    if (error) {
      let message =
        error.message ||
        "Could not end live.";

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

    const cancelled =
      Number(
        data?.cancelledUnpaidOrders ||
          0
      );

    const paidFound =
      Number(
        data?.paymentsFound ||
          0
      );

    if (cancelled > 0) {
      flash?.(
        `Live ended · ${cancelled} unpaid sale${
          cancelled === 1 ? "" : "s"
        } cancelled`
      );
    } else if (paidFound > 0) {
      flash?.(
        `Live ended · ${paidFound} paid sale${
          paidFound === 1 ? "" : "s"
        } saved`
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
