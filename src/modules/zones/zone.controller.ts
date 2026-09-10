import { Request, Response, NextFunction } from "express";
import * as zoneService from "./zone.service";
import { ok, created } from "../../utils/apiResponse";

export async function listZonesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await zoneService.listZones());
  } catch (err) {
    next(err);
  }
}

export async function createZoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    created(res, await zoneService.createZone(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateZoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await zoneService.updateZone(req.user!.id, req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deleteZoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await zoneService.deleteZone(req.params.id));
  } catch (err) {
    next(err);
  }
}
