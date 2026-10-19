import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-dvh bg-surface-950 flex flex-col items-center justify-center p-8 text-center">
      <span className="text-6xl mb-6">🔍</span>
      <h1 className="text-3xl font-bold text-surface-100 mb-2">Page Not Found</h1>
      <p className="text-surface-400 mb-8 max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex gap-3">
        <Link
          to="/pos"
          className="px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-500 transition-colors"
        >
          Go to POS
        </Link>
        <Link
          to="/dashboard"
          className="px-6 py-3 rounded-xl bg-surface-700 text-surface-200 font-medium hover:bg-surface-600 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
