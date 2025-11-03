import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      console.log('Validating request body:', _req.body);
      await schema.parseAsync(_req.body);
      console.log('Validation successful');
      next();
    } catch (error) {
      console.log('Validation failed:', error);
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