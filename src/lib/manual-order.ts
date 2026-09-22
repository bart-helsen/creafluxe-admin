// Constants for manual orders ("Nieuwe bestelling"), shared by the server-side
// validation and the client form. Kept free of server/zod imports so the form
// bundle stays small.

/** Where a manually entered order came from (stored in Order.channel). */
export const MANUAL_ORDER_CHANNELS = {
  telefoon: "Telefoon",
  email: "E-mail",
  persoonlijk: "Persoonlijk / in het atelier",
  "sociale-media": "Sociale media",
  beurs: "Beurs / markt",
  andere: "Andere",
} as const;

export type ManualOrderChannel = keyof typeof MANUAL_ORDER_CHANNELS;

/** Statuses a manual order may start in (production statuses go via the normal flow). */
export const MANUAL_ORDER_START_STATUSES = ["NEW", "QUOTE_SENT", "CONFIRMED"] as const;

/** Human label for Order.channel on screens (website + manual channels). */
export function channelLabel(channel: string): string {
  if (channel === "website") return "Webshop";
  return (MANUAL_ORDER_CHANNELS as Record<string, string>)[channel] ?? channel;
}
