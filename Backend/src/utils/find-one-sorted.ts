export async function findOneSorted<T = any>(
    query: any,
    sort: Record<string, 1 | -1>
): Promise<T | null> {
    if (query && typeof query.sort === 'function') {
        return query.sort(sort);
    }
    return query;
}
