export default <T>(arg: T): T => JSON.parse(JSON.stringify(arg)) as T;
