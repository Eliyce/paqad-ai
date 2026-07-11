const { data } = useQuery(["k"], f);
return <List items={data} />;
