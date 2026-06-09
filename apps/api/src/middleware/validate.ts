import { zodErrorsToFieldMap } from "@gigflow/shared";
import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(422).json({
        success: false,
        error: "VALIDATION_ERROR",
        errors: zodErrorsToFieldMap(result.error),
        details: result.error.flatten()
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
