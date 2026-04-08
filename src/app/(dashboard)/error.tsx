'use client';

export default function DashboardError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <div className="p-6">
      <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 alert-danger">
        <h2 className="text-base font-semibold text-red-900">We couldn’t load this page.</h2>
        <p className="mt-1 text-sm text-red-700">Please try again. If the issue continues, contact the finance systems team.</p>
        <button
          onClick={() => unstable_retry()}
          className="mt-3 rounded-md bg-[#0f172a] px-3 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
