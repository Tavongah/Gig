import { z } from "zod";
import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import {
  candidateToGeocodedAddress,
  geocodeAddressQuery,
  geocodePlaceId,
  originalDeliveryInstructions,
  resolveGeocodedLocation,
  resolveTypedDeliveryLocation,
  reverseGeocodeCoordinates,
  searchAddressSuggestions
} from "./geocoding.service.js";
import { toGeoPointInput } from "./gig-privacy.js";

const geocodeBodySchema = z.object({
  query: z.string().trim().min(3).max(240).optional(),
  placeId: z.string().trim().min(3).max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  allowIncomplete: z.boolean().optional()
}).refine(
  (value) => Boolean(value.query || value.placeId || (value.latitude !== undefined && value.longitude !== undefined)),
  { message: "Provide a query, placeId, or coordinates." }
);

export const locationRouter = Router();

locationRouter.get("/autocomplete", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const suggestions = await searchAddressSuggestions(query);
    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

locationRouter.post("/geocode", validateBody(geocodeBodySchema), async (req, res, next) => {
  try {
    const body = req.body as {
      query?: string;
      placeId?: string;
      latitude?: number;
      longitude?: number;
      allowIncomplete?: boolean;
    };
    if (body.query && body.allowIncomplete && !body.placeId && body.latitude == null) {
      const typed = await resolveTypedDeliveryLocation(body.query);
      if (typed.kind === "exact" || typed.kind === "landmark" || typed.kind === "area") {
        const address = candidateToGeocodedAddress(typed.pick);
        res.json({
          address,
          location: toGeoPointInput(address),
          precision: typed.kind,
          deliveryInstructions: originalDeliveryInstructions(typed.parsed),
          areaLabel: typed.kind === "area" ? typed.areaLabel : undefined
        });
        return;
      }
      throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
        location:
          typed.kind === "need_city"
            ? "Which city should we deliver to?"
            : typed.kind === "need_area"
              ? "Which area or suburb should we deliver to?"
              : "I found the area, but not the exact address. Add a nearby landmark."
      });
    }
    const address = await resolveGeocodedLocation(req.body);
    res.json({ address, location: toGeoPointInput(address) });
  } catch (error) {
    next(error);
  }
});

locationRouter.post("/reverse-geocode", validateBody(z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
})), async (req, res, next) => {
  try {
    const address = await reverseGeocodeCoordinates(req.body.latitude, req.body.longitude);
    res.json({ address, location: toGeoPointInput(address) });
  } catch (error) {
    next(error);
  }
});

locationRouter.get("/place/:placeId", async (req, res, next) => {
  try {
    const placeId = String(req.params.placeId);
    const address = await geocodePlaceId(placeId).catch(async () => geocodeAddressQuery(placeId));
    res.json({ address, location: toGeoPointInput(address) });
  } catch (error) {
    next(error);
  }
});
