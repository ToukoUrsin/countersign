import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { PageHeader, Shell } from './components/Shell';
import ConceptPage from './pages/Concept';
import InboxPage from './pages/Inbox';
import LedgerPage from './pages/Ledger';
import ReviewPage from './pages/Review';

function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <p className="p-5 text-base text-fg-2">
        There is no page at this address.{' '}
        <Link to="/" className="text-fg underline underline-offset-2">
          Go to the inbox
        </Link>
        .
      </p>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<InboxPage />} />
          <Route path="/pr/:slug" element={<ReviewPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/concept" element={<ConceptPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
