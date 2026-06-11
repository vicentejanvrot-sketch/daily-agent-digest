import { Linking, Platform } from "react-native";

/**
 * Open an external URL.
 *
 * On web, http/https links open in a new browser tab (with noopener for
 * security) so the user never loses the running SPA. Other schemes (mailto:,
 * tel:, app deep links) and all native platforms fall through to Linking.
 */
export async function openExternalLink(url: string): Promise<void> {
  if (!url) return;
  if (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    /^https?:\/\//i.test(url)
  ) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
