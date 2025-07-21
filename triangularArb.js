// triangularArb.js
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
  
  const bs58 = require("bs58");
  const {
    Connection,
    Keypair,
    PublicKey,
  } = require("@solana/web3.js");
  
  const { readFileSync } = require("fs");
  const { homedir } = require("os");
  const { join } = require("path");
  const { bootstrap } = require('global-agent');

  process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://172.19.32.1:7078';
  bootstrap();

  const connection = new Connection(SOLANA_RPC_URL);
  
  const getPrivateKey = () => {
    const privateKeyPath = join(homedir(), ".config", "solana", "id.json");
    const privateKeyBuffer = readFileSync(privateKeyPath);
    const privateKeyArray = JSON.parse(privateKeyBuffer.toString());
    return Uint8Array.from(privateKeyArray);
  };
  
  const wallet = Keypair.fromSecretKey(getPrivateKey());
  
  async function triangularArbitrage({
    amount = 0.01,
    slippageBps = 30,
  }) {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  
    try {
      // ========== 第一次 Swap：SOL -> USDC ==========
      const inputTokenInfo = await getTokenInfo(SOL_MINT);
      const adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
  
      const quote1 = await getQuote(SOL_MINT, USDC_MINT, adjustedAmount, slippageBps);
      if (!quote1 || !quote1.routePlan) throw new Error("No route SOL → USDC");
  
      const inst1 = await getSwapInstructions(quote1, wallet.publicKey.toString());
      const {
        setupInstructions: setup1,
        swapInstruction: swap1,
        cleanupInstruction: cleanup1,
        addressLookupTableAddresses: lookup1,
      } = inst1;
  
      // ========== 第二次 Swap：USDC -> SOL ==========
      const outputAmount = quote1.outAmount;
      const quote2 = await getQuote(USDC_MINT, SOL_MINT, outputAmount, slippageBps);
      if (!quote2 || !quote2.routePlan) throw new Error("No route USDC → SOL");
  
      const inst2 = await getSwapInstructions(quote2, wallet.publicKey.toString());
      const {
        setupInstructions: setup2,
        swapInstruction: swap2,
        cleanupInstruction: cleanup2,
        addressLookupTableAddresses: lookup2,
      } = inst2;
  
      // 合并所有指令
      const instructions = [
        ...setup1.map(deserializeInstruction),
        deserializeInstruction(swap1),
        ...(cleanup1 ? [deserializeInstruction(cleanup1)] : []),
        ...setup2.map(deserializeInstruction),
        deserializeInstruction(swap2),
        ...(cleanup2 ? [deserializeInstruction(cleanup2)] : []),
      ];
  
      // 获取 Lookup Table
      const allLookupAddresses = Array.from(new Set([...lookup1, ...lookup2]));
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(allLookupAddresses);
      const latestBlockhash = await connection.getLatestBlockhash("finalized");
  
      // 模拟交易获得 CU
      const computeUnits = await simulateTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        6
      );
      if (!computeUnits) throw new Error("Simulation failed");
  
      const priorityFee = await getAveragePriorityFee();
  
      // 构造交易
      const tx = createVersionedTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        latestBlockhash.blockhash,
        computeUnits,
        priorityFee
      );
      tx.sign([wallet]);
  
      const bundle = await createJitoBundle(tx, wallet);
      const bundleId = await sendJitoBundle(bundle);
  
      console.log(`✅ Bundle sent: ${bundleId}`);
  
      // 等待 bundle 状态
      let status = null;
      let retries = 3;
      while (retries-- > 0) {
        await new Promise((r) => setTimeout(r, 15000));
        status = await checkBundleStatus(bundleId);
        console.log(`Bundle status: ${status?.status}`);
        if (status?.status === "Landed") break;
      }
  
      if (!status || status.status !== "Landed") {
        throw new Error("Bundle failed or not landed");
      }
  
      const signature = bs58.encode(tx.signatures[0]);
      console.log(`\n🎯 Arbitrage executed!`);
      console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`);
    } catch (err) {
      console.error("❌ Arbitrage failed:", err.message);
    }
  }
  
  triangularArbitrage({ amount: 0.01, slippageBps: 30 });
  