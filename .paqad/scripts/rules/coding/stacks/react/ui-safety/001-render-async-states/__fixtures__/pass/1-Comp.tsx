const { data, isLoading, isError } = useQuery(["k"], f);
if (isLoading) return <Spin/>;
