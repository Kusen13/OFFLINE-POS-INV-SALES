/**
 * Products Page - Product management (placeholder for Milestone 3)
 */

export function ProductsPage() {
  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-50">Products</h1>
          <p className="text-surface-400 mt-1">Manage your product catalog</p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 transition-colors">
          + Add Product
        </button>
      </div>

      <div className="bg-surface-800/50 rounded-xl p-8 border border-surface-700/50 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <span className="text-5xl mb-4 block">📦</span>
          <p className="text-lg text-surface-300">Product management coming in Milestone 3</p>
          <p className="text-sm text-surface-500 mt-2">CRUD operations, search, filters, and image upload</p>
        </div>
      </div>
    </div>
  );
}
