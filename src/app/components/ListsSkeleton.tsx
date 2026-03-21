export default function ListsSkeleton() {
  return (
    <div className="w-full animate-pulse">
      {/* Скелетон для ListsTopPanel */}
      <div className="flex items-center gap-4 mb-8 bg-gray-100 h-14 rounded-2xl w-full"></div>

      {/* Скелетон для grid со списками */}
      <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-gray-100 rounded-3xl p-5 mb-6 shadow-sm h-64"
          >
            {/* Header карточки */}
            <div className="flex justify-between items-center mb-4">
              <div className="bg-gray-200 h-6 w-1/2 rounded-full"></div>
              <div className="bg-gray-200 h-8 w-8 rounded-full"></div>
            </div>
            
            {/* Items */}
            <div className="space-y-3 mt-6">
              <div className="bg-gray-100 h-10 w-full rounded-xl"></div>
              <div className="bg-gray-100 h-10 w-full rounded-xl"></div>
              <div className="bg-gray-100 h-10 w-3/4 rounded-xl"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
