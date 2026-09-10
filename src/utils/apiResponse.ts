import { Response } from "express";

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, meta });
}

export function created(res: Response, data: unknown) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res: Response) {
  return res.status(204).send();
}
