import type {ReactNode} from 'react';
import {Redirect} from '@docusaurus/router';

// Merged into /data-layer. Kept so old links (and docs links) keep working.
export default function Moved(): ReactNode {
  return <Redirect to="/data-layer" />;
}
