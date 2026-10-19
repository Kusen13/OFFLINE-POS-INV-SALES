/**
 * Dashboard Page - Overview with key metrics (placeholder for Milestone 3)
 */

export function DashboardPage() {
  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-surface-50">Dashboard</h1>
        <p className="text-surface-400 mt-1">Business overview and key metrics</p>
      </div>

      {/* Metric cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Today's Sales", value: '₱0.00', icon: '💰', color: 'from-primary-500/20 to-primary-700/20 border-primary-500/30' },
          { label: 'This Week', value: '₱0.00', icon: '📈', color: 'from-success-500/20 to-success-600/20 border-success-500/30' },
          { label: 'This Month', value: '₱0.00', icon: '📊', color: 'from-warning-500/20 to-warning-600/20 border-warning-500/30' },
          { label: 'Low Stock Items', value: '0', icon: '⚠️', color: 'from-danger-500/20 to-danger-600/20 border-danger-500/30' },
        ].map((card) => (
          <div
            key={card.label}
            className={`bg-gradient-to-br ${card.color} rounded-xl p-5 border`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-surface-300">{card.label}</p>
                <p className="text-2xl font-bold text-surface-50 mt-1">{card.value}</p>
              </div>
              <span className="text-3xl">{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder for charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-800/50 rounded-xl p-6 border border-surface-700/50 min-h-[300px] flex items-center justify-center">
          <div className="text-center">
            <span className="text-4xl mb-3 block">📊</span>
            <p className="text-surface-400">Sales charts will appear here</p>
            <p className="text-xs text-surface-500 mt-1">Built in Milestone 3</p>
          </div>
        </div>
        <div className="bg-surface-800/50 rounded-xl p-6 border border-surface-700/50 min-h-[300px] flex items-center justify-center">
          <div className="text-center">
            <span className="text-4xl mb-3 block">🏆</span>
            <p className="text-surface-400">Top products will appear here</p>
            <p className="text-xs text-surface-500 mt-1">Built in Milestone 3</p>
          </div>
        </div>
      </div>
    </div>
  );
}
