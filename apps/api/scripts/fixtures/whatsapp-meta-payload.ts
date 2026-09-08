import type { MetaWebhookPayload } from "../../src/modules/whatsapp/meta-payload.js";

/** Realistic Meta Cloud API webhook fixture (Harare coords + interactive reply). */
export const SAMPLE_META_WEBHOOK: MetaWebhookPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: "Tariro" } }],
            messages: [
              {
                id: "wamid.LOCATION_TEST_001",
                from: "263771234567",
                type: "location",
                location: {
                  latitude: -17.8252,
                  longitude: 31.0335,
                  name: "Home",
                  address: "Highfield, Harare"
                }
              },
              {
                id: "wamid.BUTTON_TEST_001",
                from: "263771234567",
                type: "interactive",
                interactive: {
                  type: "button_reply",
                  button_reply: { id: "confirm_order", title: "Confirm order" }
                }
              }
            ]
          }
        }
      ]
    }
  ]
};
