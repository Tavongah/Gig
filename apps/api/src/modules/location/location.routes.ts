import { z } from "zod";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  geocodeAddressQuery,
  geocodePlaceId,
  resolveGeocodedLocation,
  reverseGeocodeCoordinates,
  searchAddressSuggestions
} from "./geocoding.service.js";
import { toGeoPointInput } from "./gig-privacy.js";

const geocodeBodySchema = z.object({
  query: z.string().trim().min(8).max(240).optional(),
  placeId: z.string().trim().min(3).max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
}).refine(
  (value) => Boolean(value.query || value.placeId || (value.latitude !== undefined && value.longitude !== undefined)),
  { message: "Provide a query, placeId, or coordinates." }
);

export const locationRouter = Router();

locationRouter.get("/autocomplete", requireAuth, async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const suggestions = await searchAddressSuggestions(query);
    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

locationRouter.post("/geocode", requireAuth, validateBody(geocodeBodySchema), async (req, res, next) => {
  try {
    const address = await resolveGeocodedLocation(req.body);
    res.json({ address, location: toGeoPointInput(address) });
  } catch (error) {
    next(error);
  }
});

locationRouter.post("/reverse-geocode", requireAuth, validateBody(z.object({
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

locationRouter.get("/place/:placeId", requireAuth, async (req, res, next) => {
  try {
    const placeId = String(req.params.placeId);
    const address = await geocodePlaceId(placeId).catch(async () => geocodeAddressQuery(placeId));
    res.json({ address, location: toGeoPointInput(address) });
  } catch (error) {
    next(error);
  }
});
