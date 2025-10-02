import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(_req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateQuery = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(_req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateParams = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(_req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
};