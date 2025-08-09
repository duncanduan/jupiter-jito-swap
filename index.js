const {
  deserializeInstruction,
  getAddressLookupTableAccounts,
  simulateTransaction,
  createVersionedTransaction,
} = require("./transactionUtils");
const { getTokenInfo, getAveragePriorityFee } = require("./utils");
const { getQuote, getSwapInstructions } = require("./jupiterApi");
const {
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
} = require("./jitoService");
const { SOLANA_RPC_URL } = require("./config");
const bs58 = require('bs58');

const fetch = require('node-fetch');
//const { JitoJsonRpcClient } = require('jito-js-rpc');
const {
  SystemProgram,
  TransactionMessage,
  Connection,
  Transaction,
  VersionedTransaction,
  Keypair,
  PublicKey,
} = require('@solana/web3.js');
const { bootstrap } = require('global-agent');
const { readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');
const Table = require('cli-table3');
const chalk = require('chalk');


process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://172.19.32.1:7078';
bootstrap();


const connection = new Connection(SOLANA_RPC_URL);


const getPrivateKey = () => {
  try {
      const privateKeyPath = join(homedir(), '.config', 'solana', 'id.json');
      const privateKeyBuffer = readFileSync(privateKeyPath);
      const privateKeyArray = JSON.parse(privateKeyBuffer.toString());
      return Uint8Array.from(privateKeyArray);
  } catch (error) {
      console.error('Failed to load private key:', error);
      throw new Error('Private key not found or invalid');
  }
};

const wallet = Keypair.fromSecretKey(getPrivateKey());


const MIDDLE_TOKENS = [
  { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9 },
  { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  { symbol: "JupSOL", mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", decimals: 9 },
  { symbol: "USELESS", mint: "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", decimals: 6 },
  { symbol: "PENGU", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", decimals: 6 },
  { symbol: "RAY", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  { symbol: "Pege", mint: "G4ZgRBCFYMEm3JmFRg29epeTTWrWt8kbhjgsY8BFpump", decimals: 6 },
  { symbol: "TRUMP", mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", decimals: 6 },
  { symbol: "MEW", mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", decimals: 5 },
  { symbol: "SPX", mint: "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr", decimals: 8 },
  { symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", decimals: 9 },
  { symbol: "WBTC", mint: "5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ", decimals: 8 },
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
  { symbol: "PEPE", mint: "FVxWs1XeUEYECwqEDjor9WqCwRdW9TwkEubs5ACmuEYi", decimals: 6 },
];


function getSymbolByMint(mintAddress) {
  const token = MIDDLE_TOKENS.find(t => t.mint === mintAddress);
  return token ? token.symbol : "Unknown";
}

function getDecimalsByMint(mintAddress) {
 const token = MIDDLE_TOKENS.find(t => t.mint === mintAddress);
 return token ? token.decimals : null; // 或默认值，比如 9
}



async function getTokenBalance(walletPubkey, tokenMint) {
  const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  const ata = await PublicKey.findProgramAddress(
    [
      walletPubkey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      new PublicKey(tokenMint).toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const accountInfo = await connection.getParsedAccountInfo(ata[0]);

  if (!accountInfo.value) return 0;

  try {
    const amount = accountInfo.value.data.parsed.info.tokenAmount.uiAmount;
    return amount || 0;
  } catch (e) {
    return 0;
  }
}


async function swap(
  inputMint,
  outputMint,
  amount,
  slippageBps = 100,
  maxRetries = 5
) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log("\n🔄 ========== INITIATING SWAP ==========");
      console.log("🔍 Fetching token information...");
      const inputTokenInfo = await getTokenInfo(inputMint);
      const outputTokenInfo = await getTokenInfo(outputMint);

      console.log(`🔢 Input token decimals: ${inputTokenInfo.decimals}`);
      console.log(`🔢 Output token decimals: ${outputTokenInfo.decimals}`);

      const adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
      const adjustedSlippageBps = slippageBps * (1 + retries * 0.5);

      // 1. Get quote from Jupiter
      console.log("\n💰 Getting quote from Jupiter...");
      const data = await getQuote(
        inputMint,
        outputMint,
        adjustedAmount,
        adjustedSlippageBps
      );

      if (!data || !data.routePlan) {
        throw new Error("❌ No trading routes found");
      }
     
      console.log("输入币种:", data.inputMint); 
      console.log("输入数量:", Number(data.inAmount)/Math.pow(10, getDecimalsByMint(data.inputMint)) , getSymbolByMint(data.inputMint));
    
      console.log("输出币种:", data.outputMint); 
      console.log("输出数量:", Number(data.outAmount)/Math.pow(10, getDecimalsByMint(data.outputMint)) , getSymbolByMint(data.outputMint));
      console.log("最小可接受数量:", Number(data.otherAmountThreshold)/Math.pow(10, getDecimalsByMint(data.outputMint)) , getSymbolByMint(data.outputMint));
      console.log("使用路由:", data.routePlan.map(p => p.swapInfo.label));
      console.log("✅ Quote received successfully");

      // 2. Get swap instructions
      console.log("\n📝 Getting swap instructions...");
      const swapInstructions = await getSwapInstructions(
        data,
        wallet.publicKey.toString()
      );

      if (!swapInstructions || swapInstructions.error) {
        throw new Error(
          "❌ Failed to get swap instructions: " +
            (swapInstructions ? swapInstructions.error : "Unknown error")
        );
      }

      console.log("✅ Swap instructions received successfully");

      const {
        setupInstructions,
        swapInstruction: swapInstructionPayload,
        cleanupInstruction,
        addressLookupTableAddresses,
      } = swapInstructions;

      const swapInstruction = deserializeInstruction(swapInstructionPayload);

      // 3. Prepare transaction
      console.log("\n🛠️  Preparing transaction...");
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(
        addressLookupTableAddresses
      );

      const latestBlockhash = await connection.getLatestBlockhash("finalized");

      // 4. Simulate transaction to get compute units
      const instructions = [
        ...setupInstructions.map(deserializeInstruction),
        swapInstruction,
      ];

      if (cleanupInstruction) {
        instructions.push(deserializeInstruction(cleanupInstruction));
      }

      console.log("\n🧪 Simulating transaction...");
      const computeUnits = await simulateTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        5
      );

      if (computeUnits === undefined) {
        throw new Error("❌ Failed to simulate transaction");
      }

      if (computeUnits && computeUnits.error === "InsufficientFundsForRent") {
        console.log("❌ Insufficient funds for rent. Skipping this swap.");
        return null;
      }

      const priorityFee = await getAveragePriorityFee();

      console.log(`🧮 Compute units: ${computeUnits}`);
      console.log(`💸 Priority fee: ${priorityFee.microLamports} micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`);

      // 5. Create versioned transaction
      const transaction = createVersionedTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        latestBlockhash.blockhash,
        computeUnits,
        priorityFee
      );

      // 6. Sign the transaction
      transaction.sign([wallet]);

      // 7. Create and send Jito bundle
      console.log("\n📦 Creating Jito bundle...");
      const jitoBundle = await createJitoBundle(transaction, wallet);
      console.log("✅ Jito bundle created successfully");

      console.log("\n📤 Sending Jito bundle...");
      let bundleId = await sendJitoBundle(jitoBundle);
      console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

      console.log("\n🔍 Checking bundle status...");
      let bundleStatus = null;
      let bundleRetries = 3;
      const delay = 15000; // Wait 15 seconds

      while (bundleRetries > 0) {
        console.log(`⏳ Waiting for 15 seconds before checking status...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        bundleStatus = await checkBundleStatus(bundleId);

        if (bundleStatus && bundleStatus.status === "Landed") {
          console.log(`✔ Bundle finalized. Slot: ${bundleStatus.landedSlot}`);
          break;
        } else if (bundleStatus && bundleStatus.status === "Failed") {
          console.log("❌ Bundle failed. Retrying...");
          bundleId = await sendJitoBundle(jitoBundle);
          console.log(`New Bundle ID: ${bundleId}`);
        } else {
          console.log(
            `Bundle not finalized. Status: ${
              bundleStatus ? bundleStatus.status : "unknown"
            }`
          );
        }

        bundleRetries--;
      }

      if (!bundleStatus || bundleStatus.status !== "Landed") {
        throw new Error("Failed to execute swap after multiple attempts.");
      }

      console.log("\n✨ Swap executed successfully! ✨");
      console.log("========== SWAP COMPLETE ==========\n");

      const signature = bs58.encode(transaction.signatures[0]);
      return { bundleStatus, signature };
    } catch (error) {
      console.error(
        `\n❌ Error executing swap (attempt ${retries + 1}/${maxRetries}):`
      );
      console.error(error.message);
      retries++;
      if (retries >= maxRetries) {
        console.error(
          `\n💔 Failed to execute swap after ${maxRetries} attempts.`
        );
        throw error;
      }
      console.log(`\nRetrying in 2 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const amountSOL = 0.002;
const amountLamports = amountSOL * 1e9;

async function main() {

    const inputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
    const outputMint = "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr"; // SPX
    const amount = 0.002; // SPX
    const initialSlippageBps = 100; // 1% initial slippage
    const maxRetries = 5;
    const startTime = Date.now();
    const maxDuration = 24 * 60 * 60 * 1000; // 24小时（单位：毫秒）
  

    while (true) {
      const now = Date.now();
      if (now - startTime > maxDuration) {
        console.log('⏰ 已运行24小时，退出循环。');
        break;
      }   

      console.log("\n🚀 Starting swap operation...");
      console.log(`Input: ${amount} ${getSymbolByMint(inputMint)}`);
      console.log(`Output: ${getSymbolByMint(outputMint)}`);
      console.log(`Initial Slippage: ${initialSlippageBps / 100}%`);
    try {
      const result = await swap(
        inputMint,
        outputMint,
        amount,
        initialSlippageBps,
        maxRetries
      );

      if(result != null){
        console.log("\n🎉 Swap completed successfully!");
        console.log("Swap result:");
        console.log(JSON.stringify(result.bundleStatus, null, 2));
        console.log("\n🖋️  Transaction signature:", result.signature);
        console.log(`🔗 View on Solscan: https://solscan.io/tx/${result.signature}`);
      }
      await sleep(3000);
    } catch (error) {
      console.error("\n💥 Error in main function:");
      console.error(error.message);
    }
  }
}

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 每 3 分钟检查一次
const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // 最长运行 24 小时


async function checkAndSwapAllTokens() {
  const inputMint = "So11111111111111111111111111111111111111112"; // SOL
  const solAmount = 0.0015;
  const initialSlippageBps = 50;
  const maxRetries = 5;

  for (const token of MIDDLE_TOKENS) {
    if (token.mint === inputMint) continue;

    try {
      console.log(`\n🔎 检查 ${token.symbol} 余额...`);
      const balance = await getTokenBalance(wallet.publicKey, token.mint);
      const quote = await getQuote(
        inputMint,
        token.mint,
        solAmount * 1e9,
        initialSlippageBps
      );

      if (!quote || !quote.outAmount) {
        console.log(`⚠️ 无法获取 ${token.symbol} 的报价，跳过。`);
        continue;
      }

      const expectedAmount = Number(quote.outAmount) / Math.pow(10, token.decimals);
      console.log(`📊 当前余额: ${balance}, 目标: ${expectedAmount.toFixed(6)} ${token.symbol}`);

      if (balance >= expectedAmount) {
        console.log(`✅ ${token.symbol} 余额充足，跳过兑换。`);
        continue;
      }

      console.log(`🚀 开始兑换: SOL -> ${token.symbol}`);
      const result = await swap(
        inputMint,
        token.mint,
        solAmount,
        initialSlippageBps,
        maxRetries
      );

      if (result) {
        console.log(`🎉 成功兑换 ${token.symbol}`);
        console.log(`🔗 https://solscan.io/tx/${result.signature}`);
      }

      await sleep(3000);
    } catch (err) {
      console.error(`❌ ${token.symbol} 处理失败:`, err.message);
    }
  }

  console.log("\n✅ 当前轮检查和兑换完成");
}

async function runLoop() {
  const startTime = Date.now();

  while (true) {
    const now = Date.now();
    if (now - startTime > MAX_DURATION_MS) {
      console.log('⏰ 已运行24小时，退出循环。');
      break;
    }

    console.log(`\n🔄 新一轮检测开始 (${new Date().toLocaleTimeString()})`);

    await checkAndSwapAllTokens();

    console.log(`⏳ 等待 ${CHECK_INTERVAL_MS / 1000 / 60} 分钟后再次检测...`);
    await sleep(CHECK_INTERVAL_MS);
  }
}

runLoop()
//main();