import { Injectable } from '@nestjs/common';

/**
 * Stage 1b (DESIGN_GPS_TRACKING.md §5) - typed to Traccar's own OpenAPI spec
 * (https://www.traccar.org/api-reference/openapi.yaml), fields verified
 * against it rather than guessed. Only the fields GpsDevicePollingService
 * actually reads are declared - both real Traccar responses carry more.
 */
export interface TraccarDevice {
  id: number;
  uniqueId: string;
  name: string;
  status: string;
}

/**
 * speed is in KNOTS per the OpenAPI spec (not km/h) - GpsDevicePollingService
 * converts. course is degrees (0-360), accuracy is meters - both map
 * directly onto GpsLocation.heading/accuracyMeters with no conversion.
 * attributes is untyped/free-form in the spec itself (no documented
 * sub-keys) - treated as such here, not assumed to carry any particular key.
 */
export interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  accuracy: number;
  fixTime: string;
  deviceTime: string;
  attributes?: Record<string, unknown>;
}

export class TraccarApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Stage 1b - GET /devices and GET /positions behind one small client, so
 * GpsDevicePollingService itself never does raw fetch/parsing. Auth is
 * `Authorization: Bearer <token>` (Traccar's own documented ApiKey security
 * scheme) - NOT a `?token=` query parameter. Flagged explicitly: the task
 * spec for this stage described query-param auth, but Traccar's real
 * OpenAPI spec defines only BasicAuth and a Bearer ApiKey scheme for these
 * two routes (the one `token` query parameter that spec does define is on
 * GET /session, a session-cookie exchange endpoint unrelated to this
 * client) - built against the verified spec, not the task's shorthand.
 *
 * No new HTTP-client dependency - Node's built-in global fetch (confirmed
 * no axios/got/node-fetch/undici in package.json).
 */
@Injectable()
export class TraccarClient {
  async getDevices(baseUrl: string, token: string): Promise<TraccarDevice[]> {
    return this.get<TraccarDevice[]>(baseUrl, '/api/devices', token);
  }

  async getPositions(baseUrl: string, token: string): Promise<TraccarPosition[]> {
    // No deviceId/from/to params - per the spec, GET /positions with none
    // of those returns the last known position for every device visible to
    // this token, which is exactly the one-call whole-fleet poll this stage
    // wants (the spec's own note recommends the WebSocket API instead of
    // polling for anything more frequent than this).
    return this.get<TraccarPosition[]>(baseUrl, '/api/positions', token);
  }

  private async get<T>(baseUrl: string, path: string, token: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new TraccarApiError(
        `Could not reach ${baseUrl}${path}: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }
    if (!res.ok) {
      throw new TraccarApiError(`Traccar returned ${res.status} for ${path}`, res.status);
    }
    return (await res.json()) as T;
  }
}
