const v = useMemo(() => ({ user }), [user]);
return <Ctx.Provider value={v}>{c}</Ctx.Provider>;

// ok
