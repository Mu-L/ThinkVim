/**
 * ABI Definitions for Four.Meme, PancakeSwap, and ERC20
 */

// Standard ERC20 ABI
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

// PancakeSwap V2 Router ABI (Essential functions)
export const PANCAKE_ROUTER_V2_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
  'function factory() view returns (address)',
  'function WETH() view returns (address)'
];

// PancakeSwap V2 Factory ABI
export const PANCAKE_FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function allPairs(uint) view returns (address pair)',
  'function allPairsLength() view returns (uint)'
];

// PancakeSwap V2 Pair ABI
export const PANCAKE_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'event Mint(address indexed sender, uint amount0, uint amount1)',
  'event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)',
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)'
];

// Four.Meme Factory ABI (Placeholder - adjust based on actual contract)
export const FOUR_MEME_FACTORY_ABI = [
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 totalSupply, uint256 timestamp)',
  'event NewPair(address indexed token, address indexed pair, address indexed creator)',
  'function createToken(string name, string symbol, uint256 supply, uint256 liquidity) returns (address)',
  'function getToken(uint256 index) view returns (address)',
  'function getTokensCount() view returns (uint256)'
];

// Generic Token Creation Detection ABI
export const TOKEN_CREATION_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
  'event TokenCreated(address indexed token, address indexed creator)'
];

// Contract Safety Check ABIs
export const SAFETY_CHECK_ABI = [
  'function owner() view returns (address)',
  'function getOwner() view returns (address)',
  'function renounceOwnership() external',
  'function transferOwnership(address newOwner) external',
  'function setFee(uint256 fee) external',
  'function setMaxTx(uint256 amount) external',
  'function blacklist(address account) external',
  'function isBlacklisted(address account) view returns (bool)',
  'function _maxTxAmount() view returns (uint256)',
  'function _taxFee() view returns (uint256)',
  'function _liquidityFee() view returns (uint256)'
];

// WBNB ABI
export const WBNB_ABI = [
  'function deposit() payable',
  'function withdraw(uint256) external',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];
