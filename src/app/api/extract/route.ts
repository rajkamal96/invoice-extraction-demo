import { handlers } from '../../../lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: Request) => handlers.extract(req);
export const GET = () => handlers.status();
