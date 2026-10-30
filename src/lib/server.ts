import { SAMPLES } from '../generated/samples';
import { createHandlers } from './handler';

// One handler set per server instance (the in-memory rate limiter lives inside it).
export const handlers = createHandlers({ samples: SAMPLES });
