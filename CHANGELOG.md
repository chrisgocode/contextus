# Changelog

## [0.3.1](https://github.com/chrisgocode/contextus/compare/v0.3.0...v0.3.1) (2026-10-10)


### Bug Fixes

* judge Pending request liveness in one module ([#217](https://github.com/chrisgocode/contextus/issues/217)) ([0286a46](https://github.com/chrisgocode/contextus/commit/0286a46bab32971238feb64854edd55daea7b9c4))
* reject turns and Pending requests after a Room ends ([#215](https://github.com/chrisgocode/contextus/issues/215)) ([2f99f70](https://github.com/chrisgocode/contextus/commit/2f99f708e37298b0ede7e1c22401e58eba4113da)), closes [#213](https://github.com/chrisgocode/contextus/issues/213)
* show requests waiting on the Host above the guess list ([#225](https://github.com/chrisgocode/contextus/issues/225)) ([a87f479](https://github.com/chrisgocode/contextus/commit/a87f479d1c08765a997528fde7cb11c535414124))
* start hint countdown from now and show the requester's avatar on pending hints ([#224](https://github.com/chrisgocode/contextus/issues/224)) ([2083ba9](https://github.com/chrisgocode/contextus/commit/2083ba9cbfb06e52fd481a26b1a2f111c43a685c))
* **ui:** match page margins to the home page ([#205](https://github.com/chrisgocode/contextus/issues/205)) ([e2537b1](https://github.com/chrisgocode/contextus/commit/e2537b12fd592d8dc8a779991d6d852aff4b590f))


### Performance Improvements

* add Vercel Speed Insights ([#207](https://github.com/chrisgocode/contextus/issues/207)) ([ffb94d3](https://github.com/chrisgocode/contextus/commit/ffb94d35b99702224e0356d90946445a26821505))

## [0.3.0](https://github.com/chrisgocode/contextus/compare/v0.2.0...v0.3.0) (2026-10-03)


### Features

* **rooms:** move hint, give-up and request controls into an Assist sheet ([#199](https://github.com/chrisgocode/contextus/issues/199)) ([fabb341](https://github.com/chrisgocode/contextus/commit/fabb3412bb3513b6f295e894cb965a733689885c))
* **rooms:** show a requester their pending hint or give-up in the guess list ([#194](https://github.com/chrisgocode/contextus/issues/194)) ([90b8c20](https://github.com/chrisgocode/contextus/commit/90b8c2055ea22a0c34beb8e575cdb03b0dfd7a84))
* **rooms:** show the Host's requests above the guess list ([#197](https://github.com/chrisgocode/contextus/issues/197)) ([8c7d45a](https://github.com/chrisgocode/contextus/commit/8c7d45aa15b30301fc0902c6c1706db403c65c60))


### Bug Fixes

* **security:** rate limit Contexto traffic and Guest sign-ups ([#176](https://github.com/chrisgocode/contextus/issues/176)) ([2c33a68](https://github.com/chrisgocode/contextus/commit/2c33a683e3704709ab4818cc3074333e76b3b659))
* **setup:** read .env.local directly instead of checking existence first ([#204](https://github.com/chrisgocode/contextus/issues/204)) ([381ea11](https://github.com/chrisgocode/contextus/commit/381ea11a0cc2fc6922e9a5f6af7930dc509cf669))


### Dependencies

* bump @sentry/nextjs from 10.75.0 to 11.0.0 ([#202](https://github.com/chrisgocode/contextus/issues/202)) ([baa7a3a](https://github.com/chrisgocode/contextus/commit/baa7a3a372e3303893bf98d1e1bdbae1f3a87d76))
* bump the minor-and-patch group across 1 directory with 2 updates ([#201](https://github.com/chrisgocode/contextus/issues/201)) ([806b711](https://github.com/chrisgocode/contextus/commit/806b7113e3a85c2ff5697dbc662127ac642dcfcb))


### Build System

* **deps-dev:** bump dotenv from 17.4.2 to 18.0.4 ([#88](https://github.com/chrisgocode/contextus/issues/88)) ([26d34e1](https://github.com/chrisgocode/contextus/commit/26d34e19fb8fcb572459e74dff177232baf3a914))
* **deps:** bump the minor-and-patch group across 1 directory with 7 updates ([#196](https://github.com/chrisgocode/contextus/issues/196)) ([a2b68f3](https://github.com/chrisgocode/contextus/commit/a2b68f33565c9d15c31511c9374e81b1e8eddf51))

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
