# Changelog

## [0.2.0](https://github.com/chrisgocode/contextus/compare/v0.1.1...v0.2.0) (2026-10-01)


### Features

* add generic and profile not-found pages ([#188](https://github.com/chrisgocode/contextus/issues/188)) ([a598422](https://github.com/chrisgocode/contextus/commit/a598422e7afb58ede0193381120b051944d7a7bb))


### Bug Fixes

* **analytics:** encode ingest proxy path so CodeQL sees it sanitized ([#192](https://github.com/chrisgocode/contextus/issues/192)) ([2e14d5e](https://github.com/chrisgocode/contextus/commit/2e14d5e5c623110c882cf79a92a99a3a63d3f946))
* **analytics:** keep ingest proxy requests on PostHog's host ([#187](https://github.com/chrisgocode/contextus/issues/187)) ([73bf0a6](https://github.com/chrisgocode/contextus/commit/73bf0a65c04d5a7e7188e919628cb017fda5b142))
* **e2e:** retry convex env set on OCC during first push ([#180](https://github.com/chrisgocode/contextus/issues/180)) ([13486d8](https://github.com/chrisgocode/contextus/commit/13486d8cec9159c325794d6dbf83a7fa9d1dbcae))
* **ui:** stop neutral room skeleton flashing on create and leave ([#185](https://github.com/chrisgocode/contextus/issues/185)) ([2f16240](https://github.com/chrisgocode/contextus/commit/2f16240f20b6dd8e3f221447b197e7293263e784))

## [0.1.1](https://github.com/chrisgocode/contextus/compare/v0.1.0...v0.1.1) (2026-09-28)


### Bug Fixes

* **a11y:** keyboard avatar upload, no modal auto-dismiss, single unlock announcement ([#166](https://github.com/chrisgocode/contextus/issues/166)) ([1d3c3f8](https://github.com/chrisgocode/contextus/commit/1d3c3f85aa1c33a5f45d9337b1d26f277eabe424))
* **e2e:** keep e2e scripts and account purge off production ([#175](https://github.com/chrisgocode/contextus/issues/175)) ([1c318ac](https://github.com/chrisgocode/contextus/commit/1c318acf18fecd63d675c4609b5c1996d09f2b5f))
* **security:** forbid framing and send baseline security headers ([#177](https://github.com/chrisgocode/contextus/issues/177)) ([5add294](https://github.com/chrisgocode/contextus/commit/5add2943033f0ad814be83e8b2a30f47ecd33bdc))
* **users:** cap avatar uploads and delete replaced files ([#174](https://github.com/chrisgocode/contextus/issues/174)) ([e5acf00](https://github.com/chrisgocode/contextus/commit/e5acf0092d04f1a1915921e39b4b8dd4786d2663))


### Performance Improvements

* **rooms:** bound listMine and room cleanup reads ([#165](https://github.com/chrisgocode/contextus/issues/165)) ([ce464a8](https://github.com/chrisgocode/contextus/commit/ce464a8ded2dd5d5cddd1f16a33155a4e32498a1))
