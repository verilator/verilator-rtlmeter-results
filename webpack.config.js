const webpack = require("webpack")
const ESLintPlugin = require("eslint-webpack-plugin")
const StylelintPlugin = require("stylelint-webpack-plugin")
const { GitRevisionPlugin } = require("git-revision-webpack-plugin")
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin")
const CopyPlugin = require('copy-webpack-plugin')

const gitRevisionPlugin = new GitRevisionPlugin(versionCommand="describe --always")

module.exports = {
  entry: "./src/app.js",
  output: {
    path: __dirname + "/dist",
    filename: "bundle.js"
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
            MiniCssExtractPlugin.loader,
            "css-loader"
        ],
      },
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"]
          }
        }
      }
    ]
  },
  plugins: [
    new ESLintPlugin(),
    new StylelintPlugin(),
    new MiniCssExtractPlugin(),
    new webpack.DefinePlugin({
      'VERSION': JSON.stringify(gitRevisionPlugin.version()),
    }),
    new CopyPlugin({
      patterns: [
        { from: "src/data/steps.json", to: "data/steps.json" },
        { from: "src/data/metrics.json", to: "data/metrics.json" },
        { from: "src/data/runinfo.json", to: "data/runinfo.json" },
        { from: "src/data/results", to: "data/results" },
        { from: "src/data/cpuinfo", to: "data/cpuinfo" }
      ]
    })
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new JsonMinimizerPlugin()
    ]
  }
}
