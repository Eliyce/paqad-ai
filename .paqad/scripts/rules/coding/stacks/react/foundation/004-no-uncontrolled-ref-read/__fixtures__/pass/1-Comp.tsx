const [v, setV] = useState("");
<input value={v} onChange={(e) => setV(e.target.value)} />;
