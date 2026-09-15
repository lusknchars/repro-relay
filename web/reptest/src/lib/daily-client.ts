import Daily from "@daily-co/daily-js";
export function createDailyClient(container: HTMLElement) {
  if (!Daily.supportedBrowser().supported) throw new Error("This browser cannot host a Daily call. Open Relay in a supported desktop browser.");
  return Daily.createFrame(container, {
    showLeaveButton: false,
    iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "8px" },
  });
}
