# Changelog

## 0.1.0-alpha.1 (2026-10-05)


### Bug Fixes

* **auth:** read NATS key-value buckets through the stream leader ([#2804](https://github.com/chattocorp/chatto/issues/2804)) ([54c19db](https://github.com/chattocorp/chatto/commit/54c19db2adbb91eecb78e2c8a45771d36b4d25e5))
* **dev:** keep Authling state per port, reset it, and document client placement ([#2764](https://github.com/chattocorp/chatto/issues/2764)) ([d49c2b5](https://github.com/chattocorp/chatto/commit/d49c2b5c32f909f34a86f1bf857ea58616defe64))
* **events:** complete startup after target deletion and page byte-bounded reads ([#2813](https://github.com/chattocorp/chatto/issues/2813)) ([ba3faa7](https://github.com/chattocorp/chatto/commit/ba3faa746599abbf4951f29e4b942f1a1914771e))
* **events:** identify and clean up projection consumers ([#2317](https://github.com/chattocorp/chatto/issues/2317)) ([ab5c834](https://github.com/chattocorp/chatto/commit/ab5c83487cda63c492dcc6cee2e781c5b19fa972))
* **events:** retry JetStream provisioning request timeouts ([#2436](https://github.com/chattocorp/chatto/issues/2436)) ([91e6330](https://github.com/chattocorp/chatto/commit/91e6330f873d9be0c6680b58b89413b4cb3b4b48))


### Performance Improvements

* **realtime:** parallelize NATS lookups on WebSocket connect ([#2646](https://github.com/chattocorp/chatto/issues/2646)) ([7cdffe5](https://github.com/chattocorp/chatto/commit/7cdffe54ee88fd726f472d7441d80e745c74832a))

## Changelog

All notable changes to the events framework. Maintained by release-please from
the conventional-commit messages on `main` — do not edit by hand.
