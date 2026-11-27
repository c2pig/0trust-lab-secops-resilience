import React from 'react';
import { LabLeaseGuard } from './shell';
import { SecOpsResiliencePage } from './pages/SecOpsResiliencePage';

export default function App(): React.ReactElement {
  return (
    <LabLeaseGuard labSlug="secops-resilience" labTitle="AI Supply Chain & Runtime Kill Switch">
      <SecOpsResiliencePage
        onBack={() => {
          window.location.href =
            window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
              ? 'http://localhost:5173/'
              : 'https://0trust.dev/';
        }}
      />
    </LabLeaseGuard>
  );
}
