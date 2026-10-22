// Unit tests must never reach a real service. The environment schema only needs these two to parse.
process.env.AUTH_SECRET ??= "unit-test-secret-unit-test-secret-0123456789";
process.env.DATABASE_URL ??= "postgresql://unit:unit@127.0.0.1:1/unit";
