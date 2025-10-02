import { Request, Response, NextFunction } from 'express';

export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!(req as any).user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if ((req as any).user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
};