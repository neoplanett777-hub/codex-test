# 同梱ライブラリとフォント

- `pdf-lib.min.js`: pdf-lib 1.17.1, MIT。配布元: https://github.com/Hopding/pdf-lib 。全文は `pdf-lib-LICENSE.md`。
- `fontkit.umd.min.js`: @pdf-lib/fontkit 1.1.1, MIT。配布元: https://github.com/Hopding/fontkit 。同梱したnpmパッケージの `package.json` と README にMITと記載。
- `NotoSansJP-Regular.ttf`: Google Fonts の Noto Sans JP variable TTF から weight 400 を静的に抽出したもの。SIL Open Font License 1.1。配布元: https://github.com/google/fonts/tree/main/ofl/notosansjp 。ライセンス全文は `NotoSansJP-OFL.txt`。

上記ファイルはEXEと単一HTMLへ埋め込み、実行時の外部取得は行わない。
