import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(_req.body);
      next();
    } catch (error: any) {
      if (error.name === 'ZodError') {
        // Create user-friendly error messages
        const errorMessages = error.errors.map((err: any) => {
          const field = err.path.join('.');
          const message = err.message;
          
          // Custom messages for review validation
          if (field === 'title') {
            if (err.code === 'too_small') {
              return 'Review title must be at least 3 characters long';
            } else if (err.code === 'too_big') {
              return 'Review title must be no more than 100 characters long';
            }
          } else if (field === 'comment') {
            if (err.code === 'too_small') {
              return 'Review comment must be at least 10 characters long';
            } else if (err.code === 'too_big') {
              return 'Review comment must be no more than 1000 characters long';
            }
          } else if (field === 'rating') {
            if (err.code === 'too_small') {
              return 'Rating must be at least 1 star';
            } else if (err.code === 'too_big') {
              return 'Rating must be no more than 5 stars';
            } else if (err.code === 'invalid_type') {
              return 'Rating must be a number between 1 and 5';
            }
          }
          
          // Default message
          return `${field} ${message}`;
        });
        
        _res.status(400).json({ 
          error: errorMessages[0] || 'Validation failed'
        });
        return;
      }
      
      _res.status(400).json({ error: 'Validation failed: ' + error.message });
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