const path = require('path');
const webpack = require('webpack');
const envConfig = require('./env.config');

// Get the target environment; default to 'development'
const env = process.env.TIKTOKZE_ENV || 'development';
const endpoint = envConfig[env].endpoint;

module.exports = {
  entry: {
    popup: './src/popup.tsx',
    content: './src/content.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [
                  require('tailwindcss'),
                  require('autoprefixer')
                ]
              }
            }
          }
        ]
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]'
        }
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      ENDPOINT: JSON.stringify(endpoint)
    })
  ]
};


