export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-500">Coming soon.</p>
    </div>
  );
}
