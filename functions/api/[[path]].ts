import { serveResponseWorkspace, type EdgeBindings } from '../../edge/responseWorkspace';

export const onRequest = ({ request, env }: { request: Request; env: EdgeBindings }): Promise<Response> => serveResponseWorkspace(request, env);
