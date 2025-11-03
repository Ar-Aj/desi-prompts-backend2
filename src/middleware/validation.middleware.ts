import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      console.log('=== VALIDATION DEBUG INFO ===');
      console.log('Request body for validation:', _req.body);
      console.log('Schema to validate against:', schema);
      
      const result = await schema.parseAsync(_req.body);
      console.log('Validation successful, result:', result);
      next();
    } catch (error: any) {
      console.log('=== VALIDATION FAILED ===');
      console.log('Validation error:', error);
      console.log('Error details:', {
        name: error.name,
        message: error.message,
        errors: error.errors
      });
      
      // Send a more detailed error response
      if (error.name === 'ZodError') {
        const errorDetails = error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
          received: err.received,
          expected: err.expected
        }));
        console.log('Detailed validation errors:', errorDetails);
        _res.status(400).json({ 
          error: 'Validation failed',
          details: errorDetails
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