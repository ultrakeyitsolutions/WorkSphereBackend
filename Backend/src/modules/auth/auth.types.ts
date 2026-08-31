import { Request } from 'express';
import { TokenPayload } from '../../utils/tokens';

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}
